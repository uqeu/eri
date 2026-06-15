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
    python3 training/prepare_corpus.py --self-test        # run the conversion/dedup/split unit tests
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
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
# optional: blend public datasets from datasets.yaml (needs HF `datasets` + pyyaml)
# --------------------------------------------------------------------------- #
def blend_open_datasets(root: Path, n_per: int) -> list[dict]:
    """Best-effort: sample up to n_per rows from each datasets.yaml entry, convert to the same
    MLX chat format, exclude OFF_LIMITS. Heavy import (datasets) guarded by the caller; returns
    [] with a note if anything is unavailable. Records are returned ALREADY in MLX form."""
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
    for d in manifest.get("datasets", []):
        cand = {
            str(d.get("name", "")).strip().lower(),
            str(d.get("hf_id", "")).strip().lower(),
            str(d.get("hf_id", "")).strip().lower().split("/")[-1],
        }
        if cand & off_low:
            print(f"  --with-open: SKIP {d.get('name')} (OFF_LIMITS)", file=sys.stderr)
            continue
        try:
            ds = load_dataset(d["hf_id"], split="train", streaming=True)
            taken = 0
            for row in ds:
                rec = _public_row_to_mlx(row)
                if rec is not None:
                    out.append(rec)
                    taken += 1
                if taken >= n_per:
                    break
            print(f"  --with-open: {d['name']}: {taken} rows", file=sys.stderr)
        except Exception as e:  # network/schema/format issues must not kill the run
            print(f"  --with-open: SKIP {d.get('name')} ({type(e).__name__}: {e})", file=sys.stderr)
    return out


def _public_row_to_mlx(row: dict) -> dict | None:
    """Map a public-dataset row to an MLX chat record. Public sets have heterogeneous columns;
    we handle the two common shapes (a ready `messages`/`conversations` list, or
    instruction/response pairs) and skip anything we can't map. Best-effort — conversion is the
    point, not exhaustive coverage."""
    if isinstance(row.get("messages"), list) and row["messages"]:
        msgs = [
            {"role": m.get("role"), "content": m.get("content", "")}
            for m in row["messages"]
            if m.get("role") in _v.VALID_ROLES_MESSAGE
        ]
        return {"messages": msgs} if msgs else None
    if isinstance(row.get("conversations"), list) and row["conversations"]:
        role_map = {"human": "user", "gpt": "assistant", "system": "system",
                    "user": "user", "assistant": "assistant"}
        msgs = []
        for m in row["conversations"]:
            r = role_map.get(m.get("from") or m.get("role"))
            if r:
                msgs.append({"role": r, "content": m.get("value") or m.get("content", "")})
        return {"messages": msgs} if msgs else None
    instr = row.get("instruction") or row.get("prompt") or row.get("question")
    resp = row.get("response") or row.get("output") or row.get("answer")
    if instr and resp:
        msgs = [{"role": "user", "content": str(instr)},
                {"role": "assistant", "content": str(resp)}]
        ctx = row.get("context") or row.get("input")
        if ctx:
            msgs[0]["content"] = f"{instr}\n\n{ctx}"
        return {"messages": msgs}
    return None


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
    ap.add_argument("--self-test", action="store_true", help="run conversion/dedup/split unit tests and exit")
    args = ap.parse_args(argv)

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
