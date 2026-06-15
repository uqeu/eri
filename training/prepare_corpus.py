#!/usr/bin/env python3
"""eri-brain corpus prep for the MLX-LM (Apple Silicon) LoRA path.

Merges the GENERATED eri examples in `eri_data/` + `eri_data_local/`, de-duplicates them,
runs every record through `validate.py`'s provenance + invisibility + schema checks (dropping
invalids), converts to the **MLX-LM chat/tools format**, and writes a train/valid split into
`mlx_data/{train,valid}.jsonl`.

Why a converter at all? eri's records already use the messages schema with `tool_calls`
(arguments as a JSON *string*) and `role: "tool"` turns — which is exactly what mlx_lm's
chat/tools data format accepts (see mlx_lm/LORA.md). So conversion is mostly: validate, then
emit ONLY the fields mlx_lm reads (`messages` + optional top-level `tools`), dropping eri's
internal `meta` block (which carries provenance — preserved through the dedup/validation gate,
not shipped into the trainer input, exactly like the HF path strips it).

STDLIB-ONLY core. `prepare_corpus.py --dry-run`, the default eri-only run, and the self-tests
need nothing beyond the standard library (`validate.py` is reused for the gate). The OPTIONAL
`--with-open N` blend of the public datasets in `datasets.yaml` needs HF `datasets` (+ pyyaml);
if either is missing it is SKIPPED with a clear note rather than crashing.

Run:
    python3 training/prepare_corpus.py --dry-run          # plan only; no files written, no heavy imports
    python3 training/prepare_corpus.py                    # merge eri_data(+_local) -> mlx_data/{train,valid}.jsonl
    python3 training/prepare_corpus.py --with-open 200    # ALSO blend 200 rows/dataset from datasets.yaml (needs `datasets`)
    python3 training/prepare_corpus.py --probe-open       # stream 1 row/dataset through each converter; print OK/FAIL + roles
    python3 training/prepare_corpus.py --self-test        # run the conversion/dedup/split unit tests

Open-dataset converters
------------------------
Each public dataset has a DIFFERENT schema, so `OPEN_CONVERTERS` maps each `hf_id` to a
`(record) -> {"messages": [...], optional "tools": [...]} | None` function that reshapes that
dataset's native row into eri's MLX chat/tools shape (None = skip this row). The blend:
  - reads `split` (and `config`) per entry from datasets.yaml (default split "train"),
  - streams + samples N rows/dataset (never a full download),
  - tags `meta.provenance` (from the manifest) + `meta.source = hf_id`, then runs EVERY converted
    example through validate.py's schema + invisibility gate before inclusion,
  - respects OFF_LIMITS and per-source GPT/Claude-distilled exclusions (e.g. Tulu's no_robots /
    WildChat slices),
  - is per-dataset try/except so one bad dataset (gated/offline/schema drift) logs + continues.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Reuse the validator so prep and the gate agree on "valid". validate.py is stdlib-only.
try:
    import validate as _v
except ImportError:  # invoked as a module from repo root
    sys.path.insert(0, str(HERE))
    import validate as _v

# Fields mlx_lm reads from a chat/tools record. Everything else (eri's `meta`) is dropped from the
# trainer input — provenance is enforced at the gate, not carried into the model's context.
MLX_RECORD_KEYS = ("messages", "tools")
# Per-message keys mlx_lm's chat template understands.
MLX_MESSAGE_KEYS = ("role", "content", "tool_calls", "tool_call_id", "name")


# --------------------------------------------------------------------------- #
# normalization + dedup hashing
# --------------------------------------------------------------------------- #
def normalize_messages(messages: list) -> list:
    """Canonical form of the conversation for hashing: role + content + tool-call fingerprints.

    Stable across key ordering and the presence/absence of eri's `meta` block. Two records with
    the same conversation (regardless of which generator wrote them) hash identically -> deduped.
    """
    norm = []
    for m in messages:
        entry = {"role": m.get("role"), "content": m.get("content")}
        tcs = m.get("tool_calls")
        if isinstance(tcs, list) and tcs:
            entry["tool_calls"] = [
                {
                    "name": (tc.get("function") or {}).get("name"),
                    # arguments is a JSON string; re-dump parsed form so whitespace/key-order
                    # differences don't defeat dedup.
                    "arguments": _canon_args((tc.get("function") or {}).get("arguments")),
                }
                for tc in tcs
            ]
        if m.get("tool_call_id") is not None:
            entry["tool_call_id"] = m.get("tool_call_id")
        norm.append(entry)
    return norm


def _canon_args(args) -> str:
    if not isinstance(args, str):
        return json.dumps(args, sort_keys=True, ensure_ascii=False)
    try:
        return json.dumps(json.loads(args), sort_keys=True, ensure_ascii=False)
    except (json.JSONDecodeError, TypeError):
        return args


def record_hash(obj: dict) -> str:
    """SHA-256 of the normalized messages. Used to de-duplicate across the two source dirs."""
    canon = json.dumps(
        normalize_messages(obj.get("messages", [])), sort_keys=True, ensure_ascii=False
    )
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# messages -> MLX chat/tools record
# --------------------------------------------------------------------------- #
def to_mlx_record(obj: dict) -> dict:
    """Convert one validated eri record to an MLX-LM chat/tools record.

    eri's schema is already mlx-compatible: `messages` with assistant `tool_calls`
    (function.name + JSON-string arguments) and `role: "tool"` replies. mlx_lm applies the base
    model's chat template, so we keep tool_calls STRUCTURED (the Qwen chat template renders them)
    rather than flattening them into assistant text. We simply:
      - keep only mlx-recognized message keys (drop any eri-internal per-message extras),
      - drop the top-level `meta` block (provenance lives at the gate),
      - pass through a top-level `tools` array if the record carries one.
    """
    out_messages = []
    for m in obj["messages"]:
        msg = {k: m[k] for k in MLX_MESSAGE_KEYS if k in m}
        # An assistant turn that is pure tool_calls may legitimately have empty/no content.
        # mlx_lm accepts assistant turns with tool_calls and no content; leave as-is.
        out_messages.append(msg)
    rec: dict = {"messages": out_messages}
    if isinstance(obj.get("tools"), list) and obj["tools"]:
        rec["tools"] = obj["tools"]
    return rec


# --------------------------------------------------------------------------- #
# load + merge + validate + dedup
# --------------------------------------------------------------------------- #
def _load_jsonl(path: Path) -> list[tuple[int, dict]]:
    out = []
    for ln, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        out.append((ln, json.loads(raw)))
    return out


def merge_and_validate(dirs: list[Path]) -> tuple[list[dict], dict]:
    """Load every *.jsonl across `dirs`, validate each record (open-model provenance + schema +
    invisibility), DROP invalids (with a per-file count), and DEDUP by SHA-256 of normalized
    messages. First occurrence wins. Returns (kept_records, stats)."""
    seen: set[str] = set()
    kept: list[dict] = []
    stats = {"files": 0, "seen": 0, "invalid": 0, "dups": 0, "kept": 0, "per_file": {}}

    for d in dirs:
        if not d.exists():
            continue
        for f in sorted(d.glob("*.jsonl")):
            stats["files"] += 1
            fk = {"seen": 0, "invalid": 0, "dups": 0, "kept": 0}
            for ln, obj in _load_jsonl(f):
                stats["seen"] += 1
                fk["seen"] += 1
                where = f"{d.name}/{f.name}:{ln}"
                # gate: schema + invisibility + open-model provenance. Drop, don't crash.
                try:
                    _v.validate_message_obj(obj, where)
                    _v.validate_provenance(obj, where, _v.GENERATED_PROVENANCE)
                except _v.ValidationError as e:
                    stats["invalid"] += 1
                    fk["invalid"] += 1
                    print(f"  DROP (invalid) {e}", file=sys.stderr)
                    continue
                h = record_hash(obj)
                if h in seen:
                    stats["dups"] += 1
                    fk["dups"] += 1
                    continue
                seen.add(h)
                kept.append(obj)
                stats["kept"] += 1
                fk["kept"] += 1
            stats["per_file"][f"{d.name}/{f.name}"] = fk
    stats["kept"] = len(kept)
    return kept, stats


# --------------------------------------------------------------------------- #
# train/valid split
# --------------------------------------------------------------------------- #
def split_train_valid(records: list[dict], valid_frac: float, seed: int) -> tuple[list, list]:
    """Deterministic shuffle + split. Guarantees a non-empty train set whenever any record exists,
    and a non-empty valid set whenever there are >= 2 records (mlx_lm needs both)."""
    if not records:
        return [], []
    rng = random.Random(seed)
    idx = list(range(len(records)))
    rng.shuffle(idx)
    shuffled = [records[i] for i in idx]
    n = len(shuffled)
    n_valid = int(round(n * valid_frac))
    n_valid = max(1, n_valid) if n >= 2 else 0
    n_valid = min(n_valid, n - 1) if n >= 2 else 0
    valid = shuffled[:n_valid]
    train = shuffled[n_valid:]
    return train, valid


# --------------------------------------------------------------------------- #
# OPEN-DATASET CONVERTERS — one per public dataset (each has its own native schema)
#
# A converter takes ONE raw dataset row and returns an eri record:
#   {"messages": [{role, content, [tool_calls], [tool_call_id], [name]}], optional "tools": [...]}
# or None to skip the row (unmappable / empty / off-limits-by-content). NO `meta` here — the
# blend stamps meta.provenance + meta.source from the manifest before the validation gate.
#
# `_SF` maps {human|user|gpt|assistant|tool|system|function} -> eri message role.
# --------------------------------------------------------------------------- #
_SF = {"human": "user", "user": "user", "gpt": "assistant", "assistant": "assistant",
       "tool": "tool", "function": "tool", "system": "system"}

# Source-substring DENYLIST for the Tulu-3 mixture (in addition to OFF_LIMITS): GPT/Claude-distilled
# or frontier-provenance slices that must never enter the corpus. Matched case-insensitively as a
# substring against the row's `source` column.
_TULU_DENY = ("no_robots", "no-robots", "wildchat", "sharegpt", "gpt", "openai", "chatgpt",
              "claude", "anthropic", "alpaca", "wizardlm", "evol_instruct", "ultrachat", "orca")


def _msgs_from_role_content(items, role_key, content_key) -> list | None:
    """Generic [{role_key, content_key}, ...] -> eri messages via _SF. None if nothing mapped.

    `tool` turns in these datasets (ToolACE/Hermes) carry the call as text in the *prior assistant*
    turn rather than as a structured `tool_calls` array, so the tool reply has no id to bind to.
    The schema requires `tool_call_id` on tool messages, so we synthesize a per-conversation id.
    """
    msgs = []
    tool_seq = 0
    for m in items or []:
        if not isinstance(m, dict):
            continue
        r = _SF.get(str(m.get(role_key, "")).strip().lower())
        c = m.get(content_key)
        if not r or not isinstance(c, str):
            continue
        msg = {"role": r, "content": c}
        if r == "tool":
            tool_seq += 1
            msg["tool_call_id"] = f"call_{tool_seq}"
        msgs.append(msg)
    return msgs or None


def conv_oasst2(record: dict) -> dict | None:
    """oasst2 message-tree row -> a 2-turn [user, assistant] path.

    The dataset is a flat list of tree nodes. `_oasst_pairs` (the loader) does the tree
    reconstruction (prompter -> its top-ranked, non-deleted, review-passed assistant child) and
    hands THIS converter the already-paired {"prompter": text, "assistant": text} dict, so the
    converter stays a pure record->messages mapping like the others."""
    if not isinstance(record, dict):
        return None
    u, a = record.get("prompter"), record.get("assistant")
    if isinstance(u, str) and u.strip() and isinstance(a, str) and a.strip():
        return {"messages": [{"role": "user", "content": u}, {"role": "assistant", "content": a}]}
    return None


def conv_dolly(record: dict) -> dict | None:
    """dolly-15k {instruction, context, response} -> [user, assistant]."""
    instr, resp = record.get("instruction"), record.get("response")
    if not instr or not resp:
        return None
    ctx = record.get("context")
    user = f"{instr}\n\n{ctx}" if ctx and str(ctx).strip() else str(instr)
    return {"messages": [{"role": "user", "content": user},
                         {"role": "assistant", "content": str(resp)}]}


def conv_tulu(record: dict) -> dict | None:
    """tulu-3-sft {id, messages, source} -> messages, EXCLUDING GPT/Claude-distilled slices.

    Keep only human / open-model sources (filter on the `source` column via _TULU_DENY)."""
    src = str(record.get("source", "")).lower()
    if any(bad in src for bad in _TULU_DENY):
        return None
    return {"messages": m} if (m := _msgs_from_role_content(record.get("messages"), "role", "content")) else None


def conv_glaive(record: dict) -> dict | None:
    """glaive-function-calling-v2 {system, chat} -> messages (+ parsed tool calls/results).

    `chat` is a STRING with USER: / ASSISTANT: / FUNCTION RESPONSE: markers; assistant turns may
    embed `<functioncall> {json}` (name+arguments). We split on the markers, and for an assistant
    turn carrying a functioncall emit a structured tool_call (arguments as a JSON string)."""
    chat = record.get("chat")
    if not isinstance(chat, str) or not chat.strip():
        return None
    msgs: list[dict] = []
    system = record.get("system")
    if isinstance(system, str) and system.strip():
        msgs.append({"role": "system", "content": system.replace("SYSTEM:", "", 1).strip()})

    # tokenize on the role markers, preserving which marker started each chunk
    parts = re.split(r"(USER:|ASSISTANT:|FUNCTION RESPONSE:)", chat)
    cur_role = None
    tc_counter = 0
    for tok in parts:
        t = tok.strip()
        if tok in ("USER:", "ASSISTANT:", "FUNCTION RESPONSE:"):
            cur_role = {"USER:": "user", "ASSISTANT:": "assistant",
                        "FUNCTION RESPONSE:": "tool"}[tok]
            continue
        if cur_role is None or not t:
            continue
        t = t.replace("<|endoftext|>", "").strip()
        if not t:
            continue
        if cur_role == "assistant":
            fc = re.search(r"<functioncall>\s*(\{.*\})", t, re.DOTALL)
            if fc:
                raw = fc.group(1).strip().rstrip("<|endoftext|>").strip()
                try:
                    call = json.loads(raw)
                    args = call.get("arguments")
                    if not isinstance(args, str):
                        args = json.dumps(args or {}, ensure_ascii=False)
                    else:
                        json.loads(args)  # validate it parses; leave as-is if so
                    tc_counter += 1
                    msgs.append({"role": "assistant", "content": "", "tool_calls": [{
                        "id": f"call_{tc_counter}", "type": "function",
                        "function": {"name": call.get("name", "unknown"), "arguments": args}}]})
                    continue
                except (json.JSONDecodeError, TypeError):
                    pass  # malformed call -> fall through to plain assistant text
            msgs.append({"role": "assistant", "content": t})
        elif cur_role == "tool":
            # glaive doesn't carry an explicit id; bind to the most recent assistant tool_call.
            tcid = None
            for prev in reversed(msgs):
                if prev.get("tool_calls"):
                    tcid = prev["tool_calls"][0]["id"]
                    break
            msgs.append({"role": "tool", "tool_call_id": tcid or f"call_{tc_counter or 1}",
                         "content": t})
        else:  # user
            msgs.append({"role": "user", "content": t})
    return {"messages": msgs} if msgs else None


def conv_toolace(record: dict) -> dict | None:
    """ToolACE {system, conversations:[{from,value}]} -> messages (+ system folded in)."""
    msgs = _msgs_from_role_content(record.get("conversations"), "from", "value") or []
    system = record.get("system")
    if isinstance(system, str) and system.strip():
        msgs = [{"role": "system", "content": system}] + msgs
    return {"messages": msgs} if msgs else None


def conv_hermes(record: dict) -> dict | None:
    """hermes-function-calling-v1 {conversations:[{from,value}], tools} -> messages + tools.

    The system turn already embeds the <tools> block; keep the top-level `tools` array too when it
    is a list of tool schemas (mlx_lm reads a top-level `tools`)."""
    msgs = _msgs_from_role_content(record.get("conversations"), "from", "value")
    if not msgs:
        return None
    rec: dict = {"messages": msgs}
    tools = record.get("tools")
    if isinstance(tools, list) and tools:
        rec["tools"] = tools
    elif isinstance(tools, str) and tools.strip():
        try:
            parsed = json.loads(tools)
            if isinstance(parsed, list) and parsed:
                rec["tools"] = parsed
        except json.JSONDecodeError:
            pass
    return rec


def conv_xlam(record: dict) -> dict | None:
    """xlam-function-calling-60k {query, tools, answers} -> [user query, assistant tool_call(s)].

    `answers` is a JSON string (list of {name, arguments}). Empty answers (the irrelevance subset)
    -> a RESTRAINT example: the right action is to NOT call a tool, so emit a brief clarifying
    assistant reply instead of a tool_call."""
    query = record.get("query")
    if not isinstance(query, str) or not query.strip():
        return None
    tools = _maybe_json(record.get("tools")) or []
    answers = _maybe_json(record.get("answers")) or []
    rec: dict = {"messages": [{"role": "user", "content": query}]}
    if isinstance(tools, list) and tools:
        rec["tools"] = tools
    if isinstance(answers, list) and answers:
        tcs = []
        for i, a in enumerate(answers, start=1):
            if not isinstance(a, dict) or not a.get("name"):
                continue
            args = a.get("arguments")
            args = args if isinstance(args, str) else json.dumps(args or {}, ensure_ascii=False)
            tcs.append({"id": f"call_{i}", "type": "function",
                        "function": {"name": a["name"], "arguments": args}})
        if not tcs:
            return None
        rec["messages"].append({"role": "assistant", "content": "", "tool_calls": tcs})
    else:
        # irrelevance / no-call: restraint example (answer without reaching for a tool).
        rec["messages"].append({"role": "assistant",
                                "content": "I can't do that with the tools available here — "
                                           "could you clarify what you'd like me to do?"})
    return rec


def conv_when2call(record: dict) -> dict | None:
    """When2Call `mcq` row -> a restraint example keyed on `correct_answer`.

    correct_answer is one of: cannot_answer | direct | tool_call. `answers` carries the text for
    `direct`/`tool_call`; `tools` is a list of JSON-string schemas. We turn the labeled right
    action into a [user, assistant] turn (+ tools), teaching when to call vs answer/clarify."""
    q = record.get("question") or record.get("orig_question")
    if not isinstance(q, str) or not q.strip():
        return None
    label = str(record.get("correct_answer", "")).strip()
    answers = record.get("answers")
    if isinstance(answers, str):
        answers = _maybe_json(answers) or {}
    if not isinstance(answers, dict):
        answers = {}
    tools = [t for t in (_maybe_json(t) for t in (record.get("tools") or [])) if t]
    rec: dict = {"messages": [{"role": "user", "content": q}]}
    if tools:
        rec["tools"] = tools
    if label == "tool_call":
        call = answers.get("tool_call")
        call = _maybe_json(call) if isinstance(call, str) else call
        if isinstance(call, dict) and call.get("name"):
            args = call.get("arguments")
            args = args if isinstance(args, str) else json.dumps(args or {}, ensure_ascii=False)
            rec["messages"].append({"role": "assistant", "content": "", "tool_calls": [{
                "id": "call_1", "type": "function",
                "function": {"name": call["name"], "arguments": args}}]})
            return rec
        return None  # labeled tool_call but no usable call -> skip
    # direct OR cannot_answer -> answer/clarify in natural language (the restraint signal).
    text = (answers.get("direct") if label == "direct" else None) \
        or "I don't have enough to act on that — can you give me a bit more detail?"
    rec["messages"].append({"role": "assistant", "content": str(text)})
    return rec


def conv_persona(record: dict) -> dict | None:
    """Synthetic-Persona-Chat -> alternating user/assistant from the conversation string.

    `Best Generated Conversation` is a transcript with `User 1:` / `User 2:` line prefixes. Map
    User 1 -> user, User 2 -> assistant. Fold user-2's persona into a system message for warmth."""
    convo = record.get("Best Generated Conversation")
    if not isinstance(convo, str) or not convo.strip():
        return None
    msgs: list[dict] = []
    persona = record.get("user 2 personas")
    if isinstance(persona, str) and persona.strip():
        msgs.append({"role": "system",
                     "content": "You are chatting warmly and casually. Your background: "
                                + " ".join(persona.split())})
    for line in convo.splitlines():
        line = line.strip()
        m = re.match(r"^User\s*([12])\s*:\s*(.*)$", line)
        if not m:
            continue
        role = "user" if m.group(1) == "1" else "assistant"
        text = m.group(2).strip()
        if not text:
            continue
        if msgs and msgs[-1]["role"] == role:  # coalesce consecutive same-speaker lines
            msgs[-1]["content"] += "\n" + text
        else:
            msgs.append({"role": role, "content": text})
    # must start on a user turn and contain at least one assistant reply
    while msgs and msgs[0]["role"] == "assistant":
        msgs.pop(0)
    if not any(m["role"] == "assistant" for m in msgs) or not msgs:
        return None
    return {"messages": msgs}


def conv_everyday(record: dict) -> dict | None:
    """everyday-conversations -> the clean `messages` list (already role/content)."""
    return {"messages": m} if (m := _msgs_from_role_content(record.get("messages"), "role", "content")) else None


def _maybe_json(v):
    """Parse a JSON string to its object; pass objects through; None on failure."""
    if isinstance(v, str):
        try:
            return json.loads(v)
        except json.JSONDecodeError:
            return None
    return v


# hf_id -> converter. Tools-bearing datasets map their tools into a top-level `tools` array.
OPEN_CONVERTERS = {
    "OpenAssistant/oasst2": conv_oasst2,
    "databricks/databricks-dolly-15k": conv_dolly,
    "allenai/tulu-3-sft-mixture": conv_tulu,
    "glaiveai/glaive-function-calling-v2": conv_glaive,
    "Team-ACE/ToolACE": conv_toolace,
    "NousResearch/hermes-function-calling-v1": conv_hermes,
    "Salesforce/xlam-function-calling-60k": conv_xlam,
    "nvidia/When2Call": conv_when2call,
    "google/Synthetic-Persona-Chat": conv_persona,
    "HuggingFaceTB/everyday-conversations-llama3.1-2k": conv_everyday,
}


def _oasst_pairs(stream, n_target: int):
    """Yield {"prompter": text, "assistant": text} dicts reconstructed from oasst2 tree nodes.

    Streaming yields nodes grouped by message_tree_id (a tree's nodes are contiguous). For each
    prompter node we pick its best assistant child — review-passed, not deleted, lowest `rank`
    (0 = top-ranked). We scan a bounded window of nodes to find enough pairs without a full
    download. Multilingual is fine; we don't language-filter."""
    by_parent: dict = {}
    prompters: list = []
    scanned = 0
    SCAN_CAP = max(2000, n_target * 200)  # bounded read; oasst trees are small/contiguous
    for node in stream:
        scanned += 1
        if node.get("deleted") or node.get("review_result") is False:
            if scanned >= SCAN_CAP:
                break
            continue
        text = node.get("text")
        role = node.get("role")
        if not isinstance(text, str) or not text.strip():
            if scanned >= SCAN_CAP:
                break
            continue
        if role == "assistant":
            by_parent.setdefault(node.get("parent_id"), []).append(node)
        elif role == "prompter":
            prompters.append(node)
        if scanned >= SCAN_CAP:
            break
    yielded = 0
    for p in prompters:
        kids = by_parent.get(p.get("message_id"))
        if not kids:
            continue
        # lowest rank wins (rank may be None -> treat as worst)
        best = min(kids, key=lambda k: (k.get("rank") is None, k.get("rank") or 0))
        yield {"prompter": p["text"], "assistant": best["text"]}
        yielded += 1
        if yielded >= n_target:
            return


# --------------------------------------------------------------------------- #
# optional: blend public datasets from datasets.yaml (needs HF `datasets` + pyyaml)
# --------------------------------------------------------------------------- #
def _iter_dataset(load_dataset, entry: dict, n_per: int):
    """Stream rows for one manifest entry, yielding raw records to feed its converter.

    oasst2 needs tree reconstruction (yields synthesized {prompter, assistant} pairs); every other
    dataset yields its raw rows directly. Reads split/config from the manifest (default 'train')."""
    split = entry.get("split", "train")
    name = entry.get("config") or entry.get("name_config")
    kwargs = {"split": split, "streaming": True}
    if name:
        kwargs["name"] = name
    stream = load_dataset(entry["hf_id"], **kwargs)
    if entry["hf_id"] == "OpenAssistant/oasst2":
        yield from _oasst_pairs(stream, n_per)
        return
    yield from stream


def _convert_and_gate(raw, converter, entry: dict, idx_hint: int) -> dict | None:
    """Run one raw row through its converter, stamp meta, and apply validate.py's gate.

    Returns an MLX record (meta dropped) on success, None on skip/invalid."""
    try:
        rec = converter(raw)
    except Exception:  # a single malformed row must not kill the dataset
        return None
    if not rec or not rec.get("messages"):
        return None
    eri_obj = dict(rec)
    eri_obj["meta"] = {"provenance": entry.get("provenance", "open-model"),
                       "source": entry["hf_id"]}
    where = f"{entry['hf_id']}#{idx_hint}"
    try:
        _v.validate_message_obj(eri_obj, where)
    except _v.ValidationError:
        return None
    return to_mlx_record(eri_obj)


def _entry_off_limits(entry: dict, off_low: set) -> bool:
    cand = {
        str(entry.get("name", "")).strip().lower(),
        str(entry.get("hf_id", "")).strip().lower(),
        str(entry.get("hf_id", "")).strip().lower().split("/")[-1],
    }
    return bool(cand & off_low)


def blend_open_datasets(root: Path, n_per: int) -> list[dict]:
    """Sample up to n_per rows from each datasets.yaml entry, convert via OPEN_CONVERTERS to MLX
    form, run each through the validation gate, exclude OFF_LIMITS. Heavy import (datasets) guarded
    here; returns [] with a note if unavailable. Per-dataset try/except so one failure (gated /
    offline / schema drift) logs + continues. Records are returned ALREADY in MLX form."""
    try:
        import yaml  # type: ignore
        from datasets import load_dataset  # type: ignore
    except ImportError:
        print("  --with-open: HF `datasets` / pyyaml not installed — SKIPPING open-dataset blend.",
              file=sys.stderr)
        return []

    manifest = yaml.safe_load((root / "datasets.yaml").read_text(encoding="utf-8"))
    off_low = {str(x).strip().lower() for x in manifest.get("OFF_LIMITS", [])}
    out: list[dict] = []
    seen_pair: set = set()  # avoid duplicating the same hf_id under two manifest roles
    for entry in manifest.get("datasets", []):
        hf_id = entry.get("hf_id")
        if _entry_off_limits(entry, off_low):
            print(f"  --with-open: SKIP {entry.get('name')} (OFF_LIMITS)", file=sys.stderr)
            continue
        converter = OPEN_CONVERTERS.get(hf_id)
        if converter is None:
            print(f"  --with-open: SKIP {entry.get('name')} (no converter for {hf_id})",
                  file=sys.stderr)
            continue
        gate_key = (hf_id, entry.get("split", "train"), entry.get("role"))
        if gate_key in seen_pair:
            continue  # xlam appears twice (tools + restraint); convert once per (split, role)
        seen_pair.add(gate_key)
        try:
            taken = 0
            for i, raw in enumerate(_iter_dataset(load_dataset, entry, n_per)):
                mlx = _convert_and_gate(raw, converter, entry, i)
                if mlx is not None:
                    out.append(mlx)
                    taken += 1
                if taken >= n_per:
                    break
            note = "" if taken else "  (0 — schema/filter yielded nothing)"
            print(f"  --with-open: {entry['name']}: {taken} rows{note}", file=sys.stderr)
        except Exception as e:  # gated/network/schema issues must not kill the run
            gated = " [gated — set HF_TOKEN + accept terms]" if entry.get("gated") else ""
            print(f"  --with-open: SKIP {entry.get('name')} ({type(e).__name__}: "
                  f"{str(e)[:120]}){gated}", file=sys.stderr)
    return out


def probe_open(root: Path) -> int:
    """Stream EXACTLY ONE convertible example per accessible dataset through its converter + gate,
    printing OK/FAIL + the converted message roles. Fast verification, tiny download. Gated/missing
    datasets skip cleanly. Returns process exit code (0 unless an accessible dataset hard-fails)."""
    print("== prepare_corpus --probe-open (1 streamed row/dataset) ==")
    try:
        import yaml  # type: ignore
        from datasets import load_dataset  # type: ignore
    except ImportError:
        print("  HF `datasets` / pyyaml not installed — cannot probe. (Install: pip install "
              "datasets pyyaml)", file=sys.stderr)
        return 1

    manifest = yaml.safe_load((root / "datasets.yaml").read_text(encoding="utf-8"))
    off_low = {str(x).strip().lower() for x in manifest.get("OFF_LIMITS", [])}
    seen_pair: set = set()
    rc = 0
    for entry in manifest.get("datasets", []):
        hf_id = entry.get("hf_id")
        name = entry.get("name")
        if _entry_off_limits(entry, off_low):
            print(f"  SKIP  {name:24s} (OFF_LIMITS)")
            continue
        converter = OPEN_CONVERTERS.get(hf_id)
        if converter is None:
            print(f"  SKIP  {name:24s} (no converter for {hf_id})")
            continue
        gate_key = (hf_id, entry.get("split", "train"), entry.get("role"))
        if gate_key in seen_pair:
            print(f"  SKIP  {name:24s} (same hf_id+split already probed)")
            continue
        seen_pair.add(gate_key)
        try:
            mlx = None
            # scan a small window for the FIRST convertible+valid row
            for i, raw in enumerate(_iter_dataset(load_dataset, entry, 1)):
                mlx = _convert_and_gate(raw, converter, entry, i)
                if mlx is not None:
                    break
                if i >= 50:  # don't hunt forever on one probe
                    break
            if mlx is None:
                print(f"  FAIL  {name:24s} converter produced no valid example in window")
                rc = 1
                continue
            roles = [m.get("role") for m in mlx["messages"]]
            tools = " +tools" if mlx.get("tools") else ""
            tcs = " +tool_calls" if any(m.get("tool_calls") for m in mlx["messages"]) else ""
            print(f"  OK    {name:24s} roles={roles}{tcs}{tools}")
        except Exception as e:
            gated = " [gated — set HF_TOKEN + accept terms]" if entry.get("gated") else ""
            print(f"  SKIP  {name:24s} ({type(e).__name__}: {str(e)[:100]}){gated}")
    print("\nprobe-open done (gated/missing datasets skip cleanly; OK lines converted + passed the "
          "schema/invisibility gate).")
    return rc


# --------------------------------------------------------------------------- #
# write
# --------------------------------------------------------------------------- #
def write_jsonl(path: Path, records: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for r in records:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


# --------------------------------------------------------------------------- #
# orchestration
# --------------------------------------------------------------------------- #
def run(root: Path, out_dir: Path, valid_frac: float, seed: int, with_open: int,
        dry_run: bool) -> dict:
    eri_dirs = [root / "eri_data", root / "eri_data_local"]
    kept, stats = merge_and_validate(eri_dirs)

    mlx_eri = [to_mlx_record(o) for o in kept]
    open_records: list[dict] = []
    if with_open > 0 and not dry_run:
        open_records = blend_open_datasets(root, with_open)
    all_mlx = mlx_eri + open_records

    train, valid = split_train_valid(all_mlx, valid_frac, seed)

    summary = {
        "sources": [str(d.relative_to(root)) for d in eri_dirs if d.exists()],
        "merge_stats": stats,
        "eri_records": len(mlx_eri),
        "open_records": len(open_records),
        "total": len(all_mlx),
        "train": len(train),
        "valid": len(valid),
        "out_dir": str(out_dir),
    }

    if dry_run:
        return summary

    if not all_mlx:
        raise SystemExit("FATAL: no valid records to write. Generate eri_data first "
                         "(python3 training/generate_eri_data.py ...).")
    write_jsonl(out_dir / "train.jsonl", train)
    write_jsonl(out_dir / "valid.jsonl", valid)
    return summary


def print_summary(s: dict, dry_run: bool) -> None:
    tag = "PLAN (dry-run)" if dry_run else "WROTE"
    print(f"== eri MLX corpus prep — {tag} ==")
    print(f"  sources         : {', '.join(s['sources']) or '(none found)'}")
    ms = s["merge_stats"]
    print(f"  scanned         : {ms['seen']} records across {ms['files']} files")
    print(f"  dropped invalid : {ms['invalid']}   deduped: {ms['dups']}   kept: {ms['kept']}")
    print(f"  eri records     : {s['eri_records']}  + open-blend: {s['open_records']}  "
          f"=> total: {s['total']}")
    print(f"  split           : train={s['train']}  valid={s['valid']}")
    print(f"  out_dir         : {s['out_dir']}/{{train,valid}}.jsonl"
          + ("  (NOT written — dry-run)" if dry_run else ""))
    if dry_run:
        print("\n  DRY-RUN OK: would merge+dedup+convert to MLX chat format. No files written, "
              "no heavy imports.")


# --------------------------------------------------------------------------- #
# self-tests (pure — no model, no network, stdlib only)
# --------------------------------------------------------------------------- #
def _rec(content="Done.", *, prov=_v.GENERATED_PROVENANCE, user="send it",
         tool_calls=None, gen="ollama:qwen2.5:72b") -> dict:
    asst = {"role": "assistant", "content": content}
    if tool_calls is not None:
        asst["tool_calls"] = tool_calls
        asst["content"] = ""
    return {
        "messages": [{"role": "user", "content": user}, asst],
        "meta": {"provenance": prov, "generator": gen, "extra": "drop-me"},
    }


def self_test() -> bool:
    ok = True

    def check(cond, label):
        nonlocal ok
        print(("  ok   " if cond else "  FAIL ") + label, file=sys.stderr if not cond else sys.stdout)
        ok &= cond

    # --- conversion: meta dropped, only mlx keys kept ---
    mlx = to_mlx_record(_rec())
    check(set(mlx.keys()) <= set(MLX_RECORD_KEYS), "convert: only mlx top-level keys")
    check("meta" not in mlx, "convert: drops eri meta block")
    check(all(set(m.keys()) <= set(MLX_MESSAGE_KEYS) for m in mlx["messages"]),
          "convert: only mlx message keys")

    # --- conversion: tool_calls kept STRUCTURED (not flattened into text) ---
    tc = [{"id": "x", "type": "function",
           "function": {"name": "COMPOSIO_SEARCH_TOOLS", "arguments": "{\"query\":\"send\"}"}}]
    mlx_tc = to_mlx_record(_rec(tool_calls=tc))
    asst = mlx_tc["messages"][1]
    check(asst.get("tool_calls") == tc, "convert: tool_calls preserved structured")
    check(asst.get("content") == "", "convert: tool-call assistant content stays empty")

    # --- conversion: a full tool round-trip (assistant tool_call -> tool reply -> answer) ---
    round_trip = {
        "messages": [
            {"role": "user", "content": "send it"},
            {"role": "assistant", "content": "", "tool_calls": tc},
            {"role": "tool", "tool_call_id": "x", "content": "[]"},
            {"role": "assistant", "content": "Done — sent it."},
        ],
        "meta": {"provenance": _v.GENERATED_PROVENANCE},
    }
    mlx_rt = to_mlx_record(round_trip)
    check(mlx_rt["messages"][2] == {"role": "tool", "tool_call_id": "x", "content": "[]"},
          "convert: tool-role message preserved with tool_call_id")

    # --- conversion: top-level tools array passes through ---
    with_tools = dict(round_trip)
    with_tools = json.loads(json.dumps(round_trip))  # deep copy
    with_tools["tools"] = [{"type": "function", "function": {"name": "f", "parameters": {}}}]
    check(to_mlx_record(with_tools).get("tools") == with_tools["tools"],
          "convert: top-level tools array passes through")

    # --- dedup hash: identical conversation from different generators hashes the same ---
    a = _rec(gen="ollama:qwen2.5:72b")
    b = _rec(gen="moonshot:kimi-k2.7-code")  # same convo, different generator -> same hash
    check(record_hash(a) == record_hash(b), "dedup: same convo across generators -> same hash")
    c = _rec(content="Different reply.")
    check(record_hash(a) != record_hash(c), "dedup: different reply -> different hash")
    # tool-call arg whitespace/order doesn't defeat dedup
    tc1 = [{"function": {"name": "F", "arguments": "{\"a\":1,\"b\":2}"}}]
    tc2 = [{"function": {"name": "F", "arguments": "{\"b\": 2, \"a\": 1}"}}]
    check(record_hash(_rec(tool_calls=tc1)) == record_hash(_rec(tool_calls=tc2)),
          "dedup: tool-call arg order/whitespace normalized")

    # --- merge_and_validate: drops invalid, dedups, keeps clean ---
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / "eri_data").mkdir()
        (root / "eri_data_local").mkdir()
        # clean record in eri_data
        (root / "eri_data" / "a.jsonl").write_text(json.dumps(_rec(user="u1")) + "\n", "utf-8")
        # eri_data_local: a DUP of u1 + a NEW clean + an INVALID (claude provenance) + an INVALID (names a service)
        bad_prov = _rec(user="u1", prov="claude")
        bad_invis = _rec(content="Sure, I'll use Composio to send that.", user="u2")
        new_clean = _rec(user="u3")
        dup_of_u1 = _rec(user="u1")
        (root / "eri_data_local" / "b.jsonl").write_text(
            "\n".join(json.dumps(x) for x in (dup_of_u1, new_clean, bad_prov, bad_invis)) + "\n",
            "utf-8",
        )
        kept, stats = merge_and_validate([root / "eri_data", root / "eri_data_local"])
        check(stats["kept"] == 2, f"merge: keeps 2 unique clean (got {stats['kept']})")
        check(stats["dups"] == 1, f"merge: 1 dup (got {stats['dups']})")
        check(stats["invalid"] == 2, f"merge: 2 invalid dropped (got {stats['invalid']})")

    # --- split: deterministic, non-empty train/valid for >=2 records ---
    recs = [{"messages": [{"role": "user", "content": f"q{i}"}]} for i in range(20)]
    tr, va = split_train_valid(recs, 0.1, seed=42)
    check(len(tr) + len(va) == 20, "split: partitions all records")
    check(len(va) == 2 and len(tr) == 18, f"split: 90/10 -> 18/2 (got {len(tr)}/{len(va)})")
    tr2, va2 = split_train_valid(recs, 0.1, seed=42)
    check([m["messages"][0]["content"] for m in tr] == [m["messages"][0]["content"] for m in tr2],
          "split: deterministic under same seed")
    # 1 record -> all train, no valid (mlx needs a non-empty train)
    tr1, va1 = split_train_valid(recs[:1], 0.1, seed=42)
    check(len(tr1) == 1 and len(va1) == 0, "split: single record -> train only")
    # 2 records -> 1/1 (guarantee non-empty valid once possible)
    tr3, va3 = split_train_valid(recs[:2], 0.1, seed=42)
    check(len(tr3) == 1 and len(va3) == 1, "split: two records -> 1 train / 1 valid")

    # --- open-dataset converters (pure: synthetic rows -> eri shape) ---
    def roles(rec):
        return [m["role"] for m in rec["messages"]] if rec else None

    # oasst2: pre-paired prompter/assistant -> [user, assistant]
    check(roles(conv_oasst2({"prompter": "hi", "assistant": "hello"})) == ["user", "assistant"],
          "conv_oasst2: pair -> [user, assistant]")
    check(conv_oasst2({"prompter": "hi", "assistant": ""}) is None,
          "conv_oasst2: empty assistant -> skip")

    # dolly: instruction (+context) / response
    d = conv_dolly({"instruction": "Q", "context": "C", "response": "A"})
    check(roles(d) == ["user", "assistant"] and "C" in d["messages"][0]["content"],
          "conv_dolly: folds context into user turn")

    # tulu: deny GPT-distilled source, keep open source
    check(conv_tulu({"source": "ai2-adapt-dev/oasst1_converted",
                     "messages": [{"role": "user", "content": "x"},
                                  {"role": "assistant", "content": "y"}]}) is not None,
          "conv_tulu: keeps open-model source")
    check(conv_tulu({"source": "HuggingFaceH4/no_robots",
                     "messages": [{"role": "user", "content": "x"}]}) is None,
          "conv_tulu: drops no_robots (OFF_LIMITS slice)")
    check(conv_tulu({"source": "some/sharegpt_gpt4_slice",
                     "messages": [{"role": "user", "content": "x"}]}) is None,
          "conv_tulu: drops gpt/sharegpt-distilled slice")

    # glaive: string chat with a functioncall -> structured tool_call + tool reply
    glaive_chat = ("USER: rate? \n\nASSISTANT: <functioncall> {\"name\": \"get_rate\", "
                   "\"arguments\": \"{\\\"a\\\": 1}\"} <|endoftext|>\n\n"
                   "FUNCTION RESPONSE: {\"rate\": 5}\n\nASSISTANT: It's 5. <|endoftext|>")
    g = conv_glaive({"system": "SYSTEM: helper", "chat": glaive_chat})
    check(roles(g) == ["system", "user", "assistant", "tool", "assistant"],
          f"conv_glaive: marker parse -> system/user/asst/tool/asst (got {roles(g)})")
    asst_tc = g["messages"][2]
    check(bool(asst_tc.get("tool_calls")) and asst_tc["tool_calls"][0]["function"]["name"] == "get_rate",
          "conv_glaive: <functioncall> -> structured tool_call")
    check(g["messages"][3].get("tool_call_id") == asst_tc["tool_calls"][0]["id"],
          "conv_glaive: tool reply bound to the tool_call id")

    # toolace: conversations + system fold
    t = conv_toolace({"system": "expert", "conversations": [
        {"from": "user", "value": "go"}, {"from": "assistant", "value": "[API()]"},
        {"from": "tool", "value": "[]"}]})
    check(roles(t) == ["system", "user", "assistant", "tool"], "conv_toolace: from->role + system")

    # hermes: conversations + top-level tools passthrough
    h = conv_hermes({"conversations": [{"from": "system", "value": "fc"},
                                       {"from": "human", "value": "q"},
                                       {"from": "gpt", "value": "a"}],
                     "tools": [{"type": "function", "function": {"name": "f", "parameters": {}}}]})
    check(roles(h) == ["system", "user", "assistant"] and isinstance(h.get("tools"), list) and bool(h["tools"]),
          "conv_hermes: messages + tools passthrough")

    # xlam: answers -> tool_call(s); empty answers -> restraint
    x = conv_xlam({"query": "do it", "tools": "[{\"name\": \"f\"}]",
                   "answers": "[{\"name\": \"f\", \"arguments\": {\"a\": 1}}]"})
    check(roles(x) == ["user", "assistant"] and bool(x["messages"][1].get("tool_calls")),
          "conv_xlam: answers -> assistant tool_call")
    xr = conv_xlam({"query": "weather?", "tools": "[]", "answers": "[]"})
    check(roles(xr) == ["user", "assistant"] and not xr["messages"][1].get("tool_calls"),
          "conv_xlam: empty answers -> restraint (no tool_call)")

    # when2call mcq: each label
    w_tc = conv_when2call({"question": "q", "correct_answer": "tool_call",
                           "answers": {"tool_call": "{\"name\": \"f\", \"arguments\": {}}"},
                           "tools": ["{\"name\": \"f\"}"]})
    check(roles(w_tc) == ["user", "assistant"] and bool(w_tc["messages"][1].get("tool_calls")),
          "conv_when2call: tool_call label -> tool_call")
    w_d = conv_when2call({"question": "q", "correct_answer": "direct",
                          "answers": {"direct": "Here you go."}, "tools": []})
    check(roles(w_d) == ["user", "assistant"] and not w_d["messages"][1].get("tool_calls"),
          "conv_when2call: direct label -> plain answer")
    w_c = conv_when2call({"question": "q", "correct_answer": "cannot_answer",
                          "answers": {}, "tools": []})
    check(roles(w_c) == ["user", "assistant"] and not w_c["messages"][1].get("tool_calls"),
          "conv_when2call: cannot_answer -> clarify (restraint)")

    # persona: transcript -> alternating + persona system
    p = conv_persona({"user 2 personas": "I play sax.",
                      "Best Generated Conversation": "User 1: hey\nUser 2: hi there\nUser 1: cool"})
    check(p["messages"][0]["role"] == "system" and "user" in roles(p) and "assistant" in roles(p),
          "conv_persona: transcript -> system + alternating user/assistant")

    # everyday: clean messages passthrough
    e = conv_everyday({"messages": [{"role": "user", "content": "hi"},
                                    {"role": "assistant", "content": "hello"}]})
    check(roles(e) == ["user", "assistant"], "conv_everyday: messages passthrough")

    # every converter output (with meta) passes the validation gate
    gate_ok = True
    for rec in (d, t, h, x, xr, w_tc, w_d, w_c, p, e, g,
                conv_oasst2({"prompter": "hi", "assistant": "hello"})):
        obj = dict(rec)
        obj["meta"] = {"provenance": "open-model", "source": "test"}
        try:
            _v.validate_message_obj(obj, "selftest")
        except _v.ValidationError as ex:
            gate_ok = False
            print(f"    gate reject: {ex}", file=sys.stderr)
    check(gate_ok, "converters: all sample outputs pass validate.validate_message_obj")

    # registry covers every USABLE manifest hf_id (sanity: 10 converters wired)
    check(len(OPEN_CONVERTERS) == 10, f"registry: 10 converters wired (got {len(OPEN_CONVERTERS)})")

    return ok


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Prepare the eri corpus for MLX-LM LoRA training.")
    ap.add_argument("--root", default=str(HERE), help="training/ root (default: this dir)")
    ap.add_argument("--out", default=None, help="output dir (default: <root>/mlx_data)")
    ap.add_argument("--valid-frac", type=float, default=0.05, help="validation fraction (default 0.05)")
    ap.add_argument("--seed", type=int, default=42, help="shuffle seed (default 42)")
    ap.add_argument("--with-open", type=int, default=0, metavar="N",
                    help="ALSO sample N rows/dataset from datasets.yaml (needs HF `datasets`); 0=off")
    ap.add_argument("--dry-run", action="store_true",
                    help="plan only: no files written, no heavy imports, no network")
    ap.add_argument("--probe-open", action="store_true",
                    help="stream 1 example/dataset through each converter; print OK/FAIL + roles, then exit")
    ap.add_argument("--self-test", action="store_true", help="run conversion/dedup/split unit tests and exit")
    args = ap.parse_args(argv)

    if args.probe_open:
        return probe_open(Path(args.root).resolve())

    if args.self_test:
        print("== prepare_corpus self-test ==")
        if not self_test():
            print("\nSELF-TEST FAILED", file=sys.stderr)
            return 1
        print("\nself-test: PASS")
        return 0

    root = Path(args.root).resolve()
    out_dir = Path(args.out).resolve() if args.out else (root / "mlx_data")

    try:
        summary = run(root, out_dir, args.valid_frac, args.seed, args.with_open, args.dry_run)
    except (_v.ValidationError, FileNotFoundError) as e:
        print(f"PREP FAILED: {e}", file=sys.stderr)
        return 1

    print_summary(summary, args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
