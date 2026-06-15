#!/usr/bin/env python3
"""generate_eri_data.py — produce eri's REAL training data with OPEN models.

The HARD RULE (docs/architecture/personalization-learning-loop.md): eri never trains on
Claude/GPT output. So the eri-specific training examples are GENERATED FRESH by OPEN models —
Kimi K2.7 Code via the Moonshot API, or local Qwen/DeepSeek via Ollama. The generated text is the
open model's output → provenance-clean by construction. Claude only ORCHESTRATES this script; it
never authors a training example.

The Claude-authored `seeds/*.jsonl` are STRUCTURAL few-shot scaffolding only — they show the model
the target schema/shape. They are NOT copied into the corpus and are NEVER trained on.

Pipeline
--------
  for a category (meta_tools | persona | restraint | routing):
    1. load seeds/<category>.jsonl as structural exemplars (schema shape, not content to copy)
    2. build an AUTHORED generation prompt (instruction + the exemplars + a strict schema spec)
    3. call the OPEN backend (OpenAI-compatible /v1/chat/completions)
    4. parse the returned JSON examples
    5. validate EVERY example with validate.py (schema + invisibility + provenance) BEFORE writing
    6. dedup (hash of normalized messages content); reject+log failures
    7. append survivors to eri_data/<category>.jsonl, each stamped open-model provenance

Backends (--backend), all OpenAI-compatible:
  moonshot : Kimi. base from MOONSHOT_BASE_URL (default https://api.moonshot.ai/v1),
             key from MOONSHOT_API_KEY, model via --model (default kimi-k2.7-code).
  ollama   : local. base http://localhost:11434/v1, no key, model via --model (e.g. qwen2.5:72b).

HARD GUARD: the script REFUSES any base URL pointing at anthropic/openai — the generator must be
an OPEN model, never a frontier teacher.

Deps: stdlib only. Network calls use urllib; --dry-run makes NO network call. validate.py functions
are imported (not duplicated) so the generator and the gate agree on "valid".

Usage:
    # dry-run: build prompts + print plan, no network
    python3 training/generate_eri_data.py --dry-run --backend ollama --category persona --count 20

    # local open model
    python3 training/generate_eri_data.py --backend ollama --model qwen2.5:72b --category meta_tools --count 50

    # Kimi via Moonshot (export MOONSHOT_API_KEY first)
    python3 training/generate_eri_data.py --backend moonshot --model kimi-k2.7-code --category all --count 100
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Reuse the validator so the generator and the gate agree on what "valid" means.
try:
    import validate as _v
except ImportError:  # when invoked from repo root
    sys.path.insert(0, str(HERE))
    import validate as _v

CATEGORIES = ("meta_tools", "persona", "restraint", "routing")

DEFAULT_MODELS = {
    "moonshot": "kimi-k2.7-code",
    "ollama": "qwen2.5:72b",
}

# --------------------------------------------------------------------------- #
# Backend config + the PROVENANCE GUARD
# --------------------------------------------------------------------------- #
# Any backend whose base URL contains one of these host fragments is a frontier teacher and is
# categorically refused — the generator must be an OPEN model (provenance-clean by construction).
FORBIDDEN_HOST_FRAGMENTS = (
    "anthropic.com",
    "anthropic",
    "claude",
    "api.openai.com",
    "openai.azure.com",
    "openai",
)


class GenerationError(Exception):
    """A generation / backend / provenance configuration error."""


def guard_base_url(base_url: str) -> None:
    """Refuse a base URL pointing at a frontier teacher (Claude/GPT). HARD provenance gate."""
    low = base_url.lower()
    for frag in FORBIDDEN_HOST_FRAGMENTS:
        if frag in low:
            raise GenerationError(
                f"REFUSED: base URL {base_url!r} points at a frontier teacher (matched {frag!r}). "
                f"eri trains only on OPEN-model output — never Claude/GPT. Use --backend ollama or "
                f"a Moonshot/Kimi (open) endpoint."
            )


def resolve_backend(backend: str, model: str | None, base_url_override: str | None) -> dict:
    """Resolve (base_url, api_key, model) for a backend, then run the provenance guard."""
    if backend == "moonshot":
        base_url = base_url_override or os.environ.get(
            "MOONSHOT_BASE_URL", "https://api.moonshot.ai/v1"
        )
        api_key = os.environ.get("MOONSHOT_API_KEY")
        model = model or DEFAULT_MODELS["moonshot"]
    elif backend == "ollama":
        base_url = base_url_override or os.environ.get(
            "OLLAMA_BASE_URL", "http://localhost:11434/v1"
        )
        api_key = None  # local, no key
        model = model or DEFAULT_MODELS["ollama"]
    else:
        raise GenerationError(f"unknown backend {backend!r} (use moonshot|ollama)")

    guard_base_url(base_url)  # HARD GUARD — refuse anthropic/openai endpoints.

    return {"backend": backend, "base_url": base_url.rstrip("/"), "api_key": api_key, "model": model}


# --------------------------------------------------------------------------- #
# Seeds → structural few-shot exemplars
# --------------------------------------------------------------------------- #
def load_seed_exemplars(category: str, limit: int = 3) -> list[dict]:
    """Load up to `limit` seed records for a category as structural exemplars.

    Seeds are templates — used for SHAPE, never copied into the corpus.
    """
    path = HERE / "seeds" / f"{category}.jsonl"
    if not path.exists():
        raise GenerationError(f"no seed template for category {category!r} at {path}")
    out: list[dict] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        out.append(json.loads(raw))
        if len(out) >= limit:
            break
    if not out:
        raise GenerationError(f"seed template {path} has no examples")
    return out


# --------------------------------------------------------------------------- #
# AUTHORED generation prompts (per category)
# --------------------------------------------------------------------------- #
_SCHEMA_SPEC = (
    'Each example is a JSON object: {"messages":[...], "meta":{...}}.\n'
    'messages is a list of {"role","content"} turns; roles are system, user, assistant, tool.\n'
    'An assistant turn may instead carry "tool_calls":[{"id","type":"function",'
    '"function":{"name","arguments"}}] where arguments is a JSON STRING. A tool turn carries '
    '"tool_call_id" and "content".\n'
    'INVISIBILITY RULE (critical): the assistant\'s natural-language content shown to the user must '
    'NEVER name a tool, service, Composio, MCP, or say "tool call"/"function call". Tool names live '
    'ONLY inside tool_calls plumbing, never in what eri says to the user.'
)

_CATEGORY_INSTRUCTIONS = {
    "meta_tools": (
        "Produce eri training examples that show the CORRECT multi-step Composio meta-tool flow: "
        "the assistant discovers tools with COMPOSIO_SEARCH_TOOLS, fetches exact schemas with "
        "COMPOSIO_GET_TOOL_SCHEMAS, then executes with COMPOSIO_MULTI_EXECUTE_TOOL, then replies in "
        "plain natural language. Vary the domain (email, calendar, messaging, docs, issues, files), "
        "the user's phrasing, and the specific underlying tools surfaced — but keep the search→"
        "schemas→execute→answer skeleton. The final assistant reply must be warm and natural and "
        "must NOT mention any tool/service."
    ),
    "persona": (
        "Produce eri persona/voice examples: warm, natural, concise — like texting a sharp friend. "
        "Short exchanges, casual register, genuinely helpful. Vary mood, time of day, and topic. "
        "eri NEVER names tools, services, Composio, or MCP; it just talks plainly."
    ),
    "restraint": (
        "Produce tool-use RESTRAINT examples: the right move is to answer DIRECTLY from knowledge or "
        "the user's memory WITHOUT calling any tool. General knowledge, simple math, recall of a "
        "stated preference, clarifying questions. No tool_calls at all in these — just a direct, "
        "natural answer. Vary the question type and domain."
    ),
    "routing": (
        "Produce mode-routing examples that convey the build / control / answer / chat feel: build = "
        "write or change code; control = act on the computer/apps; answer = factual/knowledge; chat "
        "= casual. The assistant responds in the register the request implies. Vary which mode each "
        "example exercises. Never name tools or services in the natural-language reply."
    ),
}


def build_generation_messages(category: str, count: int, exemplars: list[dict]) -> list[dict]:
    """Build the OpenAI-style messages payload that instructs the open model to generate examples."""
    if category not in _CATEGORY_INSTRUCTIONS:
        raise GenerationError(f"no instruction for category {category!r}")

    exemplar_block = "\n".join(json.dumps(e, ensure_ascii=False) for e in exemplars)

    system = (
        "You are a data-generation engine producing fine-tuning examples for 'eri', an agentic "
        "assistant. You output ONLY training data, as JSON. You are an open model; your output is "
        "the training corpus."
    )
    user = (
        f"Generate {count} fresh, varied, high-quality eri training examples for the category "
        f"'{category}'.\n\n"
        f"CATEGORY GOAL:\n{_CATEGORY_INSTRUCTIONS[category]}\n\n"
        f"OUTPUT SCHEMA:\n{_SCHEMA_SPEC}\n\n"
        "STRUCTURAL EXEMPLARS (copy the SHAPE, never the content — invent fresh prompts, domains, "
        "and phrasings):\n"
        f"{exemplar_block}\n\n"
        f"Return ONLY a JSON array of {count} example objects. No prose, no markdown fences, no "
        "commentary — just the JSON array. Each object MUST follow the schema above and obey the "
        "invisibility rule. Make every example distinct from the exemplars and from each other."
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


# --------------------------------------------------------------------------- #
# Backend call (OpenAI-compatible /v1/chat/completions) — shared path
# --------------------------------------------------------------------------- #
def call_backend(cfg: dict, messages: list[dict], *, temperature: float = 0.9,
                 timeout: float = 300.0, retries: int = 2) -> str:
    """POST to <base_url>/chat/completions and return the assistant message content (text).

    Retries transient failures (timeouts/network/partial body) up to `retries` times —
    slow reasoning models (Kimi K2.7 Code, local 72B) routinely exceed a short timeout
    on the first try, so an unattended run must tolerate it.
    """
    guard_base_url(cfg["base_url"])  # belt-and-suspenders: never call a guarded URL.
    url = f"{cfg['base_url']}/chat/completions"
    # Some models only accept a fixed temperature — Kimi K2.7 Code rejects
    # anything but temperature=1 (HTTP 400). Honor that rather than 400-ing.
    effective_temperature = 1.0 if "kimi" in cfg["model"].lower() else temperature
    payload = json.dumps({
        "model": cfg["model"],
        "messages": messages,
        "temperature": effective_temperature,
        "stream": False,
    }).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if cfg.get("api_key"):
        headers["Authorization"] = f"Bearer {cfg['api_key']}"

    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    last_err: Exception | None = None
    for _ in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - guarded URL
                body = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, json.JSONDecodeError) as e:
            # OSError covers ConnectionResetError / BrokenPipe / socket timeouts
            # (e.g. when the Mac sleeps mid-request) — all transient, so retry.
            last_err = e
            continue
        try:
            return body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as e:
            raise GenerationError(f"unexpected backend response shape: {e}: {str(body)[:200]}")
    raise GenerationError(
        f"backend call failed after {retries + 1} tries ({cfg['backend']} @ {url}): {last_err}"
    )


# --------------------------------------------------------------------------- #
# Parse + validate + dedup + stamp provenance
# --------------------------------------------------------------------------- #
def parse_examples(text: str) -> list[dict]:
    """Parse the model's reply into a list of example dicts. Tolerates markdown fences / stray prose."""
    s = text.strip()
    # strip a ```json ... ``` fence if present
    if s.startswith("```"):
        s = s.split("```", 2)
        s = s[1] if len(s) >= 2 else text
        if s.lstrip().lower().startswith("json"):
            s = s.lstrip()[4:]
        s = s.strip()
    # find the outermost JSON array
    start = s.find("[")
    end = s.rfind("]")
    if start == -1 or end == -1 or end <= start:
        raise GenerationError("could not locate a JSON array in the backend reply")
    arr = json.loads(s[start:end + 1])
    if not isinstance(arr, list):
        raise GenerationError("backend reply did not parse to a JSON array")
    return arr


def _normalize_for_hash(obj: dict) -> str:
    """Stable hash key over the messages content only (ignores meta) for dedup."""
    msgs = obj.get("messages", [])
    norm = [
        {"role": m.get("role"), "content": (m.get("content") or "").strip().lower(),
         "tool_calls": m.get("tool_calls")}
        for m in msgs
    ]
    return hashlib.sha256(
        json.dumps(norm, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def stamp_provenance(obj: dict, generator: str) -> dict:
    """Return a copy with meta.{generator, provenance:'open-model'} (immutable update)."""
    meta = dict(obj.get("meta") or {})
    meta["generator"] = generator
    meta["provenance"] = _v.GENERATED_PROVENANCE  # "open-model"
    return {**obj, "meta": meta}


def filter_and_stamp(examples: list[dict], generator: str, seen: set[str],
                     where: str) -> tuple[list[dict], list[str]]:
    """Validate + dedup + stamp. Returns (accepted_records, rejection_log)."""
    accepted: list[dict] = []
    rejected: list[str] = []
    for i, ex in enumerate(examples):
        loc = f"{where}[{i}]"
        if not isinstance(ex, dict):
            rejected.append(f"{loc}: not a JSON object")
            continue
        stamped = stamp_provenance(ex, generator)
        # validate schema + invisibility + provenance via the shared gate
        try:
            _v.validate_message_obj(stamped, loc)
            _v.validate_provenance(stamped, loc, _v.GENERATED_PROVENANCE)
        except _v.ValidationError as e:
            rejected.append(f"{loc}: rejected by validator: {e}")
            continue
        key = _normalize_for_hash(stamped)
        if key in seen:
            rejected.append(f"{loc}: duplicate (content hash)")
            continue
        seen.add(key)
        accepted.append(stamped)
    return accepted, rejected


def existing_hashes(out_path: Path) -> set[str]:
    """Hashes of records already in the output file, so re-runs dedup against prior output."""
    seen: set[str] = set()
    if not out_path.exists():
        return seen
    for raw in out_path.read_text(encoding="utf-8").splitlines():
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        try:
            seen.add(_normalize_for_hash(json.loads(raw)))
        except json.JSONDecodeError:
            continue
    return seen


def append_records(out_path: Path, records: list[dict]) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("a", encoding="utf-8") as fh:
        for r in records:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


# --------------------------------------------------------------------------- #
# Per-category generation
# --------------------------------------------------------------------------- #
def generate_category(cfg: dict, category: str, count: int, out_dir: Path, *,
                      dry_run: bool, exemplar_limit: int = 3) -> dict:
    exemplars = load_seed_exemplars(category, limit=exemplar_limit)
    messages = build_generation_messages(category, count, exemplars)
    generator = f"{cfg['backend']}:{cfg['model']}"
    out_path = out_dir / f"{category}.jsonl"

    plan = {
        "category": category,
        "count_requested": count,
        "generator": generator,
        "base_url": cfg["base_url"],
        "out_path": str(out_path),
        "exemplars_used": len(exemplars),
        "prompt_chars": sum(len(m["content"]) for m in messages),
    }

    if dry_run:
        plan["dry_run"] = True
        return plan

    # Generate in small per-call batches: each request stays fast + robust (slow
    # reasoning models time out on one big call), one bad batch doesn't sink the
    # run, and `seen` is shared so filter_and_stamp dedups across batches + the
    # existing file.
    BATCH = 4
    seen = existing_hashes(out_path)
    total_parsed = 0
    accepted_total: list[dict] = []
    rejections: list[str] = []
    attempts = 0
    max_attempts = (count + BATCH - 1) // BATCH * 3 + 3  # cap; avoids infinite loops
    while len(accepted_total) < count and attempts < max_attempts:
        attempts += 1
        n = min(BATCH, count - len(accepted_total))
        batch_messages = build_generation_messages(category, n, exemplars)
        try:
            reply = call_backend(cfg, batch_messages)
            parsed = parse_examples(reply)
        except (GenerationError, json.JSONDecodeError, ValueError) as e:
            # A model returning malformed JSON (common with smaller local models)
            # must drop just this batch, never crash the unattended run.
            rejections.append(f"batch {attempts}: {e}")
            continue
        total_parsed += len(parsed)
        accepted, rejected = filter_and_stamp(parsed, generator, seen, where=f"{category}.b{attempts}")
        append_records(out_path, accepted)
        accepted_total.extend(accepted)
        rejections.extend(rejected)

    plan.update({
        "parsed": total_parsed,
        "accepted": len(accepted_total),
        "rejected": len(rejections),
        "attempts": attempts,
        "rejections": rejections[:20],
    })
    return plan


def print_plan(plan: dict, dry_run: bool) -> None:
    if dry_run:
        print(f"  [{plan['category']}] DRY-RUN: would request {plan['count_requested']} examples")
        print(f"     generator   : {plan['generator']}")
        print(f"     base_url     : {plan['base_url']}")
        print(f"     exemplars    : {plan['exemplars_used']} (structural, from seeds/)")
        print(f"     prompt size  : {plan['prompt_chars']} chars")
        print(f"     -> out       : {plan['out_path']}  (NO network call made)")
    else:
        print(f"  [{plan['category']}] {plan['generator']}: "
              f"parsed={plan['parsed']} accepted={plan['accepted']} rejected={plan['rejected']} "
              f"-> {plan['out_path']}")
        for r in plan.get("rejections", []):
            print(f"     REJECT {r}", file=sys.stderr)


# --------------------------------------------------------------------------- #
# Self-tests — no network; exercise guard, parse, validate/dedup, provenance stamp
# --------------------------------------------------------------------------- #
def _expect_raises(fn, exc, label: str) -> bool:
    try:
        fn()
    except exc:
        print(f"  ok   (raised) {label}")
        return True
    print(f"  FAIL (no raise) {label}", file=sys.stderr)
    return False


def _expect_ok(fn, label: str) -> bool:
    try:
        fn()
    except Exception as e:  # noqa: BLE001
        print(f"  FAIL ({e}) {label}", file=sys.stderr)
        return False
    print(f"  ok   {label}")
    return True


def self_test() -> bool:
    ok = True

    # provenance guard refuses anthropic/openai base URLs
    ok &= _expect_raises(lambda: guard_base_url("https://api.anthropic.com/v1"),
                         GenerationError, "guard refuses anthropic base URL")
    ok &= _expect_raises(lambda: guard_base_url("https://api.openai.com/v1"),
                         GenerationError, "guard refuses openai base URL")
    ok &= _expect_raises(
        lambda: resolve_backend("moonshot", "kimi-k2.7-code", "https://api.openai.com/v1"),
        GenerationError, "resolve_backend refuses openai override")
    # ...but allows the open endpoints
    ok &= _expect_ok(lambda: guard_base_url("https://api.moonshot.ai/v1"),
                     "guard allows moonshot base URL")
    ok &= _expect_ok(lambda: guard_base_url("http://localhost:11434/v1"),
                     "guard allows ollama base URL")

    # parse tolerates a markdown fence
    fenced = '```json\n[{"messages":[{"role":"user","content":"hi"}],"meta":{}}]\n```'
    ok &= _expect_ok(lambda: parse_examples(fenced), "parse strips ```json fence")

    # filter_and_stamp: a clean example is accepted + stamped open-model; an invisibility
    # violation is rejected; a duplicate is rejected.
    good = {"messages": [{"role": "user", "content": "morning"},
                         {"role": "assistant", "content": "morning! what's first?"}], "meta": {}}
    bad = {"messages": [{"role": "user", "content": "send it"},
                        {"role": "assistant", "content": "Sure, I'll use Composio."}], "meta": {}}
    seen: set[str] = set()
    accepted, rejected = filter_and_stamp([good, bad, good], "ollama:qwen2.5:72b", seen, "selftest")

    def _check_filter() -> None:
        assert len(accepted) == 1, f"expected 1 accepted, got {len(accepted)}"
        assert accepted[0]["meta"]["provenance"] == "open-model", "missing open-model stamp"
        assert accepted[0]["meta"]["generator"] == "ollama:qwen2.5:72b", "missing generator stamp"
        # one invisibility reject + one duplicate reject
        assert len(rejected) == 2, f"expected 2 rejected, got {len(rejected)}: {rejected}"
        assert any("validator" in r for r in rejected), "expected a validator rejection"
        assert any("duplicate" in r for r in rejected), "expected a duplicate rejection"

    ok &= _expect_ok(_check_filter, "filter_and_stamp accepts good, rejects bad+dup, stamps provenance")

    # a deliberately-bad GENERATED example (names a tool to the user) must be rejected by the gate
    deliberately_bad = {"messages": [{"role": "user", "content": "x"},
                                     {"role": "assistant", "content": "I'll call the gmail_ tool."}],
                        "meta": {}}
    acc2, rej2 = filter_and_stamp([deliberately_bad], "ollama:m", set(), "selftest")
    ok &= _expect_ok(lambda: (_ for _ in ()).throw(AssertionError("not rejected"))
                     if acc2 or not rej2 else None,
                     "deliberately-bad generated example rejected by validator")

    # build_generation_messages embeds the schema + exemplars
    exes = load_seed_exemplars("persona", limit=2)
    msgs = build_generation_messages("persona", 5, exes)
    ok &= _expect_ok(
        lambda: (_ for _ in ()).throw(AssertionError("prompt missing pieces"))
        if ("INVISIBILITY" not in msgs[1]["content"] or "OUTPUT SCHEMA" not in msgs[1]["content"])
        else None,
        "generation prompt contains schema + invisibility rule",
    )

    return ok


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Generate eri training data with OPEN models (no teacher).")
    ap.add_argument("--backend", choices=["moonshot", "ollama"], default="ollama",
                    help="open-model backend (default: ollama)")
    ap.add_argument("--model", default=None,
                    help="model id (default per backend: %s)" % DEFAULT_MODELS)
    ap.add_argument("--base-url", default=None,
                    help="override base URL (still subject to the anthropic/openai guard)")
    ap.add_argument("--category", default="all",
                    help="meta_tools|persona|restraint|routing|all (default: all)")
    ap.add_argument("--count", type=int, default=20, help="examples per category (default: 20)")
    ap.add_argument("--out", default=str(HERE / "eri_data"), help="output dir (default: eri_data/)")
    ap.add_argument("--dry-run", action="store_true",
                    help="build prompts + print the plan; makes NO network call")
    ap.add_argument("--self-test", action="store_true", help="run self-tests (no network) and exit")
    args = ap.parse_args(argv)

    if args.self_test:
        print("== generate_eri_data self-test (no network) ==")
        ok = self_test()
        print("  self-test: PASS" if ok else "  self-test: FAIL")
        return 0 if ok else 1

    cats = list(CATEGORIES) if args.category == "all" else [args.category]
    for c in cats:
        if c not in CATEGORIES:
            print(f"FATAL: unknown category {c!r} (choose from {CATEGORIES} or 'all')", file=sys.stderr)
            return 2

    try:
        cfg = resolve_backend(args.backend, args.model, args.base_url)
    except GenerationError as e:
        print(f"FATAL: {e}", file=sys.stderr)
        return 2

    if args.backend == "moonshot" and not cfg["api_key"] and not args.dry_run:
        print("FATAL: MOONSHOT_API_KEY not set (export it, or use --dry-run / --backend ollama).",
              file=sys.stderr)
        return 2

    out_dir = Path(args.out)
    mode = "DRY-RUN (no network)" if args.dry_run else "GENERATE"
    print(f"== eri data generation — {mode} ==")
    print(f"  backend={cfg['backend']} model={cfg['model']} base_url={cfg['base_url']}")
    print(f"  categories={cats} count/category={args.count} out={out_dir}")
    print("  PROVENANCE: open model only. Seeds are structural scaffolding, NOT training data. "
          "Claude only orchestrates.\n")

    total_accepted = 0
    for c in cats:
        try:
            plan = generate_category(cfg, c, args.count, out_dir, dry_run=args.dry_run)
        except GenerationError as e:
            print(f"  [{c}] ERROR: {e}", file=sys.stderr)
            return 1
        print_plan(plan, args.dry_run)
        total_accepted += plan.get("accepted", 0)

    if args.dry_run:
        print("\n  DRY-RUN OK: prompts built, no network call made. "
              "Re-run without --dry-run against an OPEN backend.")
    else:
        print(f"\n  DONE: {total_accepted} examples accepted + written (open-model provenance). "
              "Run `python3 training/validate.py` to re-verify the corpus.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
