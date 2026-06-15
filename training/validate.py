#!/usr/bin/env python3
"""eri-brain training validator + self-check.

STDLIB-ONLY core. The JSONL / invisibility / provenance checks use nothing but the standard
library, so the GREEN GATE runs anywhere — no GPU, no network, no pyyaml. Only the optional
datasets.yaml / config.yaml *parse* uses pyyaml; if pyyaml is absent those two checks are SKIPPED
with a clear warning (exit 0) rather than crashing. The core provenance + invisibility lint always
runs.

Checks
------
(a) eri_data/*.jsonl (GENERATED training data): every line parses, matches the messages schema, the
    assistant never names a tool/service to the USER (invisibility lint — structured tool_calls are
    exempt), AND every record carries clean open-model provenance
    (meta.provenance == "open-model"). This is the real training corpus.
(b) seeds/*.jsonl (SEED TEMPLATES, not training data): validated for messages schema + invisibility
    only. Exempt from the "is this real training data?" provenance rule — seeds are Claude-authored
    structural scaffolding (meta.provenance == "seed-template") and are NEVER trained on. Comment
    lines (starting with '#') are allowed and skipped.
(c) datasets.yaml: every entry has provenance in {human, open-model}, valid role, NONE collide with
    OFF_LIMITS.  [SKIPPED if pyyaml absent]
(d) config.yaml: parses, references a Qwen base model, sane LoRA params.  [SKIPPED if pyyaml absent]

Run:
    python3 training/validate.py                # validate the real files + run self-tests
    python3 training/validate.py --no-self-test # validate files only

Exits non-zero on any violation. Exits 0 (with a warning) if pyyaml is missing — the yaml-only
checks are skipped but the stdlib provenance + invisibility gate still ran.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# pyyaml is OPTIONAL. The core (JSONL/invisibility/provenance) is stdlib-only. Only the
# datasets.yaml / config.yaml parse needs yaml; if it's missing we skip those two, never crash.
try:
    import yaml  # type: ignore

    HAVE_YAML = True
except ImportError:  # pragma: no cover - exercised in the no-pyyaml shell
    yaml = None  # type: ignore
    HAVE_YAML = False

HERE = Path(__file__).resolve().parent

VALID_ROLES_MESSAGE = {"system", "user", "assistant", "tool"}
VALID_PROVENANCE = {"human", "open-model"}
VALID_DATASET_ROLES = {"chat", "tools", "restraint", "persona"}

# Provenance tags for the messages-JSONL records (distinct from the dataset-manifest provenance):
#   open-model    -> generated fresh by an OPEN model (Kimi/Qwen/DeepSeek) — the real training data.
#   seed-template -> Claude-authored structural scaffolding in seeds/ — NEVER trained on.
GENERATED_PROVENANCE = "open-model"
SEED_PROVENANCE = "seed-template"

# Names that must NEVER appear in an assistant's natural-language reply to the user (invisibility).
# Case-insensitive substring match on assistant `content` only. Tool plumbing (function.name in
# tool_calls, the system prompt, and tool-role messages) is exempt — those are not shown as eri's
# voice to the user.
FORBIDDEN_IN_ASSISTANT_CONTENT = [
    "composio",
    "mcp",
    "COMPOSIO_SEARCH_TOOLS",
    "COMPOSIO_GET_TOOL_SCHEMAS",
    "COMPOSIO_MULTI_EXECUTE_TOOL",
    "gmail_",
    "slack_",
    "googlecalendar_",
    "github_",
    "tool call",
    "function call",
]


class ValidationError(Exception):
    """A provenance / schema / invisibility violation."""


# --------------------------------------------------------------------------- #
# (a/b) messages schema + invisibility lint + provenance  (STDLIB-ONLY)
# --------------------------------------------------------------------------- #
def lint_assistant_content(content: str, where: str) -> None:
    low = content.lower()
    for needle in FORBIDDEN_IN_ASSISTANT_CONTENT:
        if needle.lower() in low:
            raise ValidationError(
                f"{where}: assistant reply names a tool/service to the user "
                f"(found '{needle}'): {content[:80]!r}"
            )


def validate_message_obj(obj: dict, where: str) -> None:
    if not isinstance(obj, dict):
        raise ValidationError(f"{where}: line is not a JSON object")
    if "messages" not in obj or not isinstance(obj["messages"], list) or not obj["messages"]:
        raise ValidationError(f"{where}: missing non-empty 'messages' list")
    if "meta" not in obj or not isinstance(obj["meta"], dict):
        raise ValidationError(f"{where}: missing 'meta' object")

    for i, msg in enumerate(obj["messages"]):
        loc = f"{where} msg[{i}]"
        if not isinstance(msg, dict):
            raise ValidationError(f"{loc}: not an object")
        role = msg.get("role")
        if role not in VALID_ROLES_MESSAGE:
            raise ValidationError(f"{loc}: bad role {role!r}")

        has_content = isinstance(msg.get("content"), str)
        has_tool_calls = isinstance(msg.get("tool_calls"), list) and msg["tool_calls"]

        if role == "assistant":
            # assistant turn must have content (possibly empty) or tool_calls
            if not has_content and not has_tool_calls:
                raise ValidationError(f"{loc}: assistant turn has neither content nor tool_calls")
            if has_content:
                lint_assistant_content(msg["content"], loc)
            if has_tool_calls:
                for tc in msg["tool_calls"]:
                    fn = (tc.get("function") or {}).get("name")
                    if not fn:
                        raise ValidationError(f"{loc}: tool_call missing function.name")
                    args = (tc.get("function") or {}).get("arguments")
                    if not isinstance(args, str):
                        raise ValidationError(f"{loc}: tool_call arguments must be a JSON string")
                    try:
                        json.loads(args)
                    except json.JSONDecodeError as e:
                        raise ValidationError(f"{loc}: tool_call arguments not valid JSON: {e}")
        elif role == "tool":
            if "tool_call_id" not in msg:
                raise ValidationError(f"{loc}: tool message missing tool_call_id")
            if not has_content:
                raise ValidationError(f"{loc}: tool message missing content")
        else:  # system / user
            if not has_content:
                raise ValidationError(f"{loc}: {role} message missing content")


def validate_provenance(obj: dict, where: str, require: str) -> None:
    """Enforce the meta.provenance tag for a messages record.

    `require` is the EXACT provenance this corpus must carry:
      - "open-model"    for generated eri_data/ (the real training data),
      - "seed-template" for seeds/ (Claude-authored scaffolding, never trained on).
    """
    prov = (obj.get("meta") or {}).get("provenance")
    if prov != require:
        raise ValidationError(
            f"{where}: provenance must be {require!r}, got {prov!r}"
        )


def validate_jsonl_text(text: str, where: str, require_provenance: str | None = None) -> int:
    """Validate one JSONL document. Comment lines ('#') and blank lines are skipped.

    If `require_provenance` is set, every record must carry that exact meta.provenance tag.
    """
    n = 0
    for ln, raw in enumerate(text.splitlines(), start=1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError as e:
            raise ValidationError(f"{where}:{ln}: invalid JSON: {e}")
        validate_message_obj(obj, f"{where}:{ln}")
        if require_provenance is not None:
            validate_provenance(obj, f"{where}:{ln}", require_provenance)
        n += 1
    if n == 0:
        raise ValidationError(f"{where}: no examples found")
    return n


def validate_messages_dir(data_dir: Path, require_provenance: str | None, allow_empty: bool) -> dict:
    files = sorted(data_dir.glob("*.jsonl"))
    if not files:
        if allow_empty:
            return {}
        raise ValidationError(f"no JSONL files in {data_dir}")
    counts = {}
    for f in files:
        counts[f.name] = validate_jsonl_text(
            f.read_text(encoding="utf-8"), f.name, require_provenance
        )
    return counts


def validate_eri_data(data_dir: Path) -> dict:
    """GENERATED training data — must be open-model provenance. Empty is OK (pre-generation)."""
    return validate_messages_dir(data_dir, require_provenance=GENERATED_PROVENANCE, allow_empty=True)


def validate_seeds(seeds_dir: Path) -> dict:
    """SEED TEMPLATES — schema + invisibility only; must carry the seed-template tag, never trained."""
    return validate_messages_dir(seeds_dir, require_provenance=SEED_PROVENANCE, allow_empty=True)


# --------------------------------------------------------------------------- #
# (c) datasets.yaml provenance + OFF_LIMITS  (needs pyyaml)
# --------------------------------------------------------------------------- #
def validate_datasets_manifest(text: str, where: str = "datasets.yaml") -> dict:
    if not HAVE_YAML:  # pragma: no cover - guarded by caller
        raise ValidationError(f"{where}: pyyaml required to parse")
    doc = yaml.safe_load(text)
    if not isinstance(doc, dict):
        raise ValidationError(f"{where}: not a mapping")
    datasets = doc.get("datasets")
    if not isinstance(datasets, list) or not datasets:
        raise ValidationError(f"{where}: 'datasets' must be a non-empty list")
    off_limits = doc.get("OFF_LIMITS")
    if not isinstance(off_limits, list) or not off_limits:
        raise ValidationError(f"{where}: 'OFF_LIMITS' must be a non-empty list")

    off_low = {str(x).strip().lower() for x in off_limits}
    by_role: dict[str, int] = {}

    for i, d in enumerate(datasets):
        loc = f"{where} datasets[{i}]"
        if not isinstance(d, dict):
            raise ValidationError(f"{loc}: not a mapping")
        for key in ("name", "hf_id", "license", "provenance", "role", "notes"):
            if key not in d:
                raise ValidationError(f"{loc}: missing required key '{key}'")
        if d["provenance"] not in VALID_PROVENANCE:
            raise ValidationError(
                f"{loc} ({d['name']}): provenance must be human|open-model, got {d['provenance']!r}"
            )
        if d["role"] not in VALID_DATASET_ROLES:
            raise ValidationError(f"{loc} ({d['name']}): bad role {d['role']!r}")
        # provenance is the law: no dataset may appear in OFF_LIMITS by name OR hf_id (incl. the
        # last path segment of the hf_id, e.g. ".../No-Robots").
        candidates = {
            str(d["name"]).strip().lower(),
            str(d["hf_id"]).strip().lower(),
            str(d["hf_id"]).strip().lower().split("/")[-1],
        }
        clash = candidates & off_low
        if clash:
            raise ValidationError(
                f"{loc} ({d['name']}): collides with OFF_LIMITS entry {sorted(clash)!r}"
            )
        by_role[d["role"]] = by_role.get(d["role"], 0) + 1

    return {"by_role": by_role, "total": len(datasets), "off_limits": len(off_limits)}


# --------------------------------------------------------------------------- #
# (d) config.yaml  (needs pyyaml)
# --------------------------------------------------------------------------- #
def validate_config(text: str, where: str = "config.yaml") -> dict:
    if not HAVE_YAML:  # pragma: no cover - guarded by caller
        raise ValidationError(f"{where}: pyyaml required to parse")
    cfg = yaml.safe_load(text)
    if not isinstance(cfg, dict):
        raise ValidationError(f"{where}: not a mapping")

    model = cfg.get("model") or {}
    base_id = str(model.get("base_id", ""))
    if "qwen" not in base_id.lower():
        raise ValidationError(f"{where}: model.base_id must reference a Qwen model, got {base_id!r}")

    lora = cfg.get("lora") or {}
    r = lora.get("r")
    alpha = lora.get("alpha")
    if not isinstance(r, int) or r <= 0:
        raise ValidationError(f"{where}: lora.r must be a positive int, got {r!r}")
    if not isinstance(alpha, int) or alpha <= 0:
        raise ValidationError(f"{where}: lora.alpha must be a positive int, got {alpha!r}")
    tm = lora.get("target_modules")
    if not isinstance(tm, list) or not tm:
        raise ValidationError(f"{where}: lora.target_modules must be a non-empty list")

    if not cfg.get("training", {}).get("output_dir"):
        raise ValidationError(f"{where}: training.output_dir is required")

    return {"base_id": base_id, "lora_r": r, "lora_alpha": alpha, "target_modules": len(tm)}


# --------------------------------------------------------------------------- #
# Top-level run over the real files
# --------------------------------------------------------------------------- #
def run_validation(root: Path = HERE) -> dict:
    # STDLIB-ONLY core — always runs.
    seed_counts = validate_seeds(root / "seeds")
    eri_counts = validate_eri_data(root / "eri_data")

    result: dict = {
        "seeds": seed_counts,
        "eri_data": eri_counts,
        "datasets": None,
        "config": None,
        "yaml_skipped": not HAVE_YAML,
    }

    # YAML-only checks — skipped (not crashed) when pyyaml is absent.
    if HAVE_YAML:
        result["datasets"] = validate_datasets_manifest(
            (root / "datasets.yaml").read_text(encoding="utf-8")
        )
        result["config"] = validate_config((root / "config.yaml").read_text(encoding="utf-8"))
    return result


# --------------------------------------------------------------------------- #
# Self-tests — confirm the validator FAILS on deliberately-bad fixtures
# --------------------------------------------------------------------------- #
def _expect_fail(fn, label: str) -> bool:
    try:
        fn()
    except ValidationError:
        print(f"  ok   (rejected) {label}")
        return True
    print(f"  FAIL (accepted bad) {label}", file=sys.stderr)
    return False


def _expect_pass(fn, label: str) -> bool:
    try:
        fn()
    except ValidationError as e:
        print(f"  FAIL (rejected good) {label}: {e}", file=sys.stderr)
        return False
    print(f"  ok   (accepted) {label}")
    return True


def _gen_record(content: str = "Done — sent it.", provenance: str = GENERATED_PROVENANCE) -> str:
    return json.dumps({
        "messages": [
            {"role": "user", "content": "send it"},
            {"role": "assistant", "content": content},
        ],
        "meta": {"provenance": provenance, "generator": "ollama:qwen2.5:72b"},
    })


def self_test() -> bool:
    ok = True

    # --- stdlib-only core (always runs, no pyyaml needed) ---

    # invisibility lint must reject an assistant naming a service
    bad_invis = json.dumps({
        "messages": [
            {"role": "user", "content": "send it"},
            {"role": "assistant", "content": "Sure, I'll use Composio to send that."},
        ],
        "meta": {"provenance": GENERATED_PROVENANCE},
    })
    ok &= _expect_fail(
        lambda: validate_jsonl_text(bad_invis, "selftest", GENERATED_PROVENANCE),
        "invisibility: names Composio",
    )

    # tool_calls carrying COMPOSIO_* in function.name is EXEMPT (legit plumbing) -> must pass
    good_toolcall = json.dumps({
        "messages": [
            {"role": "user", "content": "send it"},
            {"role": "assistant", "content": "", "tool_calls": [
                {"id": "x", "type": "function",
                 "function": {"name": "COMPOSIO_SEARCH_TOOLS", "arguments": "{\"query\":\"send\"}"}}
            ]},
            {"role": "tool", "tool_call_id": "x", "content": "[]"},
            {"role": "assistant", "content": "Done — sent it."},
        ],
        "meta": {"provenance": GENERATED_PROVENANCE},
    })
    ok &= _expect_pass(
        lambda: validate_jsonl_text(good_toolcall, "selftest", GENERATED_PROVENANCE),
        "tool_calls exempt from invisibility",
    )

    # a clean generated record (open-model provenance) must pass
    ok &= _expect_pass(
        lambda: validate_jsonl_text(_gen_record(), "selftest", GENERATED_PROVENANCE),
        "clean generated record (open-model)",
    )

    # a generated record MISSING open-model provenance must fail (provenance gate)
    ok &= _expect_fail(
        lambda: validate_jsonl_text(_gen_record(provenance="authored"), "selftest", GENERATED_PROVENANCE),
        "generated record without open-model provenance",
    )

    # a Claude/GPT-tagged generated record must fail
    ok &= _expect_fail(
        lambda: validate_jsonl_text(_gen_record(provenance="claude"), "selftest", GENERATED_PROVENANCE),
        "generated record tagged claude provenance",
    )

    # comment lines + blank lines are skipped, not parsed as JSON
    with_comments = "# this is a header comment\n\n" + _gen_record()
    ok &= _expect_pass(
        lambda: validate_jsonl_text(with_comments, "selftest", GENERATED_PROVENANCE),
        "comment + blank lines skipped",
    )

    # seed-template records are validated for schema but exempt from open-model rule
    seed_rec = _gen_record(provenance=SEED_PROVENANCE)
    ok &= _expect_pass(
        lambda: validate_jsonl_text(seed_rec, "seedtest", SEED_PROVENANCE),
        "seed-template record accepted under seed rule",
    )
    # ...but a seed-template record would FAIL the eri_data (open-model) rule — never trained on
    ok &= _expect_fail(
        lambda: validate_jsonl_text(seed_rec, "seedtest", GENERATED_PROVENANCE),
        "seed-template rejected by eri_data provenance rule",
    )

    # malformed JSON line must fail
    ok &= _expect_fail(
        lambda: validate_jsonl_text("{not json", "selftest", GENERATED_PROVENANCE),
        "malformed JSON",
    )

    # bad role must fail
    bad_role = json.dumps({"messages": [{"role": "robot", "content": "hi"}],
                           "meta": {"provenance": GENERATED_PROVENANCE}})
    ok &= _expect_fail(
        lambda: validate_jsonl_text(bad_role, "selftest", GENERATED_PROVENANCE),
        "invalid message role",
    )

    # tool_call with non-JSON arguments must fail
    bad_args = json.dumps({
        "messages": [
            {"role": "user", "content": "x"},
            {"role": "assistant", "content": "", "tool_calls": [
                {"id": "a", "type": "function", "function": {"name": "FOO", "arguments": "not-json"}}
            ]},
        ],
        "meta": {"provenance": GENERATED_PROVENANCE},
    })
    ok &= _expect_fail(
        lambda: validate_jsonl_text(bad_args, "selftest", GENERATED_PROVENANCE),
        "tool_call args not JSON",
    )

    # --- yaml-dependent checks: run only when pyyaml is present (skipped, not failed, otherwise) ---
    if not HAVE_YAML:
        print("  skip (no pyyaml) datasets.yaml / config.yaml self-tests")
        return ok

    # datasets: provenance not in {human, open-model} must fail
    bad_prov = yaml.safe_dump({
        "datasets": [{"name": "x", "hf_id": "a/x", "license": "mit",
                      "provenance": "synthetic", "role": "chat", "notes": "n"}],
        "OFF_LIMITS": ["Orca"],
    })
    ok &= _expect_fail(lambda: validate_datasets_manifest(bad_prov, "selftest"), "bad provenance")

    # datasets: a dataset that collides with OFF_LIMITS must fail
    bad_offlimits = yaml.safe_dump({
        "datasets": [{"name": "OpenHermes-2.5", "hf_id": "teknium/OpenHermes-2.5",
                      "license": "mit", "provenance": "open-model", "role": "chat", "notes": "n"}],
        "OFF_LIMITS": ["OpenHermes-2.5"],
    })
    ok &= _expect_fail(lambda: validate_datasets_manifest(bad_offlimits, "selftest"), "OFF_LIMITS collision")

    # datasets: a clean entry must pass
    good_ds = yaml.safe_dump({
        "datasets": [{"name": "dolly", "hf_id": "databricks/databricks-dolly-15k",
                      "license": "cc-by-sa-3.0", "provenance": "human", "role": "chat", "notes": "n"}],
        "OFF_LIMITS": ["Orca"],
    })
    ok &= _expect_pass(lambda: validate_datasets_manifest(good_ds, "selftest"), "clean dataset entry")

    # config: non-Qwen base must fail
    bad_cfg = yaml.safe_dump({
        "model": {"base_id": "meta-llama/Llama-3-8B"},
        "lora": {"r": 16, "alpha": 32, "target_modules": ["q_proj"]},
        "training": {"output_dir": "./out"},
    })
    ok &= _expect_fail(lambda: validate_config(bad_cfg, "selftest"), "non-Qwen base model")

    # config: a Qwen base with sane LoRA must pass
    good_cfg = yaml.safe_dump({
        "model": {"base_id": "Qwen/Qwen3-32B"},
        "lora": {"r": 16, "alpha": 32, "target_modules": ["q_proj", "v_proj"]},
        "training": {"output_dir": "./out"},
    })
    ok &= _expect_pass(lambda: validate_config(good_cfg, "selftest"), "valid Qwen config")

    return ok


def main(argv: list[str]) -> int:
    do_self_test = "--no-self-test" not in argv

    print("== validating eri training files ==")
    if not HAVE_YAML:
        print("  WARNING: pyyaml not installed — SKIPPING datasets.yaml / config.yaml parse checks.")
        print("           (stdlib core: seeds + eri_data provenance + invisibility lint still runs.)")
    try:
        result = run_validation()
    except (ValidationError, FileNotFoundError) as e:
        print(f"VALIDATION FAILED: {e}", file=sys.stderr)
        return 1

    sd = result["seeds"]
    print(f"  seeds (templates, NOT trained): {sum(sd.values())} examples across {len(sd)} files")
    for name, c in sd.items():
        print(f"    {name}: {c}")
    ed = result["eri_data"]
    if ed:
        print(f"  eri_data (GENERATED, open-model): {sum(ed.values())} examples across {len(ed)} files")
        for name, c in ed.items():
            print(f"    {name}: {c}")
    else:
        print("  eri_data (GENERATED, open-model): empty — run generate_eri_data.py to populate.")

    if result["datasets"] is not None:
        ds = result["datasets"]
        print(f"  datasets.yaml: {ds['total']} datasets, {ds['off_limits']} OFF_LIMITS")
        print(f"    by role: {ds['by_role']}")
    if result["config"] is not None:
        cfg = result["config"]
        print(f"  config.yaml: base={cfg['base_id']} lora_r={cfg['lora_r']} "
              f"alpha={cfg['lora_alpha']} target_modules={cfg['target_modules']}")
    print("  files: VALID")

    if do_self_test:
        print("\n== self-test (validator must reject bad fixtures, accept good) ==")
        if not self_test():
            print("\nSELF-TEST FAILED", file=sys.stderr)
            return 1
        print("  self-test: PASS")

    print("\nALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
