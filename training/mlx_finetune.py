#!/usr/bin/env python3
"""eri-brain LoRA fine-tune via Apple's MLX-LM — the Apple Silicon (M-series) training path.

The CUDA path (`lora_finetune.py`, HF PEFT + bitsandbytes) WON'T run on a Mac (bnb is CUDA-only).
This is the Apple-native alternative: it LoRA-trains Qwen3-32B with `mlx_lm.lora` on the corpus
that `prepare_corpus.py` writes into `mlx_data/{train,valid}.jsonl`.

It reads LoRA params from `config.yaml` (rank/alpha/dropout/target-modules) and maps them onto
mlx_lm's config:
  - lora.r            -> lora_parameters.rank
  - lora.alpha + r    -> lora_parameters.scale   (mlx_lm uses scale = alpha / rank)
  - lora.dropout      -> lora_parameters.dropout
  - len(target_modules) is informational: mlx_lm applies LoRA to the top `num_layers` transformer
    blocks (default below) rather than naming HF projection modules. We surface both so the mapping
    is auditable. The Qwen attention+MLP projections in config.yaml are the HF-path target set.

Base model: defaults to the MLX-community 4-bit Qwen3-32B (`mlx-community/Qwen3-32B-4bit`), which
is the Apple-native quantized build mlx_lm loads directly. Override with --model or by pointing
config.yaml's model.base_id at any MLX-compatible repo.

Usage:
    python3 training/mlx_finetune.py --dry-run     # validate data dir + print the exact mlx_lm.lora
                                                   #   command + write the generated config; NO training,
                                                   #   NO model download, NO GPU-hours.
    python3 training/mlx_finetune.py               # real run: invokes mlx_lm.lora (HOURS on a 32B)

--dry-run imports nothing heavy (no mlx). The real run shells out to `mlx_lm.lora --config ...`.
"""

from __future__ import annotations

import argparse
import shlex
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

try:
    import yaml  # type: ignore
    HAVE_YAML = True
except ImportError:
    yaml = None  # type: ignore
    HAVE_YAML = False

# Apple-native default base: MLX-community 4-bit Qwen3-32B. mlx_lm loads this directly on M-series.
# (config.yaml's base_id is Qwen/Qwen3-32B for the CUDA path; for MLX we prefer the converted 4-bit
#  repo so a 32B fits in unified memory and trains in hours, not the bf16 HF weights.)
DEFAULT_MLX_MODEL = "mlx-community/Qwen3-32B-4bit"

# Sane MLX-LM LoRA defaults for a 32B on an M-series (128GB). Tunable via flags.
DEFAULTS = {
    "num_layers": 16,        # LoRA on the top 16 transformer blocks (mlx_lm semantics)
    "iters": 1000,
    "batch_size": 1,
    "learning_rate": 2e-4,   # matches config.yaml training.learning_rate
    "max_seq_length": 4096,  # matches config.yaml data.max_seq_len
    "save_every": 200,
    "steps_per_eval": 200,
    "steps_per_report": 10,
    "grad_accumulation_steps": 16,
    "val_batches": 25,
    "seed": 42,
}


def load_config(path: Path) -> dict:
    if not HAVE_YAML:
        # config.yaml is small + flat enough; but rather than hand-roll a YAML parser we require
        # pyyaml for the REAL config read. The --dry-run still works with built-in fallbacks if the
        # config can't be parsed (it prints a clear note and uses DEFAULTS + config-derived guesses).
        raise RuntimeError("pyyaml required to read config.yaml (`pip install pyyaml`)")
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def derive_mlx_config(cfg: dict | None, model: str, data_dir: Path, adapter_path: Path,
                      overrides: dict) -> dict:
    """Build the mlx_lm.lora config dict from eri's config.yaml + flag overrides."""
    lora = (cfg or {}).get("lora", {}) if cfg else {}
    train = (cfg or {}).get("training", {}) if cfg else {}
    data = (cfg or {}).get("data", {}) if cfg else {}

    rank = int(lora.get("r", 16))
    alpha = int(lora.get("alpha", 32))
    dropout = float(lora.get("dropout", 0.05))
    scale = round(alpha / rank, 4) if rank else 20.0  # mlx_lm: scale = alpha / rank

    mlx_cfg = {
        "model": model,
        "train": True,
        "fine_tune_type": "lora",
        "data": str(data_dir),
        "adapter_path": str(adapter_path),
        "seed": overrides.get("seed", train.get("seed", DEFAULTS["seed"])),
        "num_layers": overrides.get("num_layers", DEFAULTS["num_layers"]),
        "batch_size": overrides.get("batch_size",
                                    train.get("per_device_train_batch_size", DEFAULTS["batch_size"])),
        "iters": overrides.get("iters", DEFAULTS["iters"]),
        "learning_rate": overrides.get("learning_rate",
                                       train.get("learning_rate", DEFAULTS["learning_rate"])),
        "max_seq_length": overrides.get("max_seq_length",
                                        data.get("max_seq_len", DEFAULTS["max_seq_length"])),
        "grad_accumulation_steps": overrides.get(
            "grad_accumulation_steps",
            train.get("gradient_accumulation_steps", DEFAULTS["grad_accumulation_steps"])),
        "val_batches": DEFAULTS["val_batches"],
        "steps_per_report": DEFAULTS["steps_per_report"],
        "steps_per_eval": overrides.get("steps_per_eval", DEFAULTS["steps_per_eval"]),
        "save_every": overrides.get("save_every", train.get("save_steps", DEFAULTS["save_every"])),
        "grad_checkpoint": bool(train.get("gradient_checkpointing", True)),
        "lora_parameters": {"rank": rank, "scale": scale, "dropout": dropout},
    }
    return mlx_cfg


def validate_data_dir(data_dir: Path) -> dict:
    """The data dir must contain a non-empty train.jsonl (and ideally valid.jsonl). Counts lines so
    the dry-run fails loud BEFORE a multi-hour run if prepare_corpus wasn't run."""
    train = data_dir / "train.jsonl"
    valid = data_dir / "valid.jsonl"
    if not data_dir.exists():
        raise FileNotFoundError(
            f"data dir {data_dir} missing — run `python3 training/prepare_corpus.py` first.")
    if not train.exists():
        raise FileNotFoundError(
            f"{train} missing — run `python3 training/prepare_corpus.py` to create train/valid.")

    def _count(p: Path) -> int:
        if not p.exists():
            return 0
        return sum(1 for ln in p.read_text(encoding="utf-8").splitlines() if ln.strip())

    n_train = _count(train)
    n_valid = _count(valid)
    if n_train == 0:
        raise FileNotFoundError(f"{train} is empty — nothing to train on.")
    return {"train": n_train, "valid": n_valid,
            "valid_present": valid.exists(), "data_dir": str(data_dir)}


def build_command(config_file: Path) -> list[str]:
    """The exact command mlx_lm runs. mlx_lm.lora --config consumes the generated YAML; CLI flags
    would override it but we keep all knobs IN the config for reproducibility."""
    return [sys.executable, "-m", "mlx_lm", "lora", "--config", str(config_file)]


def write_mlx_config(path: Path, mlx_cfg: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if HAVE_YAML:
        path.write_text(yaml.safe_dump(mlx_cfg, sort_keys=False), encoding="utf-8")
    else:  # minimal emitter so --dry-run can still write a readable config without pyyaml
        path.write_text(_dumb_yaml(mlx_cfg), encoding="utf-8")


def _dumb_yaml(d: dict, indent: int = 0) -> str:
    out = []
    pad = "  " * indent
    for k, v in d.items():
        if isinstance(v, dict):
            out.append(f"{pad}{k}:")
            out.append(_dumb_yaml(v, indent + 1))
        elif isinstance(v, bool):
            out.append(f"{pad}{k}: {str(v).lower()}")
        else:
            out.append(f"{pad}{k}: {v}")
    return "\n".join(out) + ("\n" if indent == 0 else "")


def print_plan(mlx_cfg: dict, cmd: list[str], data_stats: dict, config_file: Path,
               cfg: dict | None) -> None:
    print("== eri-brain MLX-LM LoRA — PLANNED RUN (dry-run) ==")
    print(f"  base model      : {mlx_cfg['model']}  (Apple-native 4-bit; override --model)")
    print(f"  data dir        : {mlx_cfg['data']}  (train={data_stats['train']} "
          f"valid={data_stats['valid']})")
    if not data_stats["valid_present"]:
        print("    note          : no valid.jsonl — mlx_lm will skip eval (fine for a tiny corpus).")
    lp = mlx_cfg["lora_parameters"]
    src = "config.yaml" if cfg else "defaults"
    print(f"  LoRA ({src:^11}): rank={lp['rank']} scale={lp['scale']} (= alpha/rank) "
          f"dropout={lp['dropout']}")
    print(f"  applied to      : top {mlx_cfg['num_layers']} transformer layers (mlx_lm semantics)")
    if cfg:
        tms = cfg.get("lora", {}).get("target_modules", [])
        print(f"    HF target set : {tms}  (informational — used by the CUDA/PEFT path)")
    print(f"  schedule        : iters={mlx_cfg['iters']} batch={mlx_cfg['batch_size']} "
          f"grad_accum={mlx_cfg['grad_accumulation_steps']} lr={mlx_cfg['learning_rate']} "
          f"max_seq={mlx_cfg['max_seq_length']}")
    print(f"  checkpoints     : adapter_path={mlx_cfg['adapter_path']} save_every="
          f"{mlx_cfg['save_every']} eval_every={mlx_cfg['steps_per_eval']}")
    print(f"  generated config: {config_file}")
    print("\n  EXACT COMMAND mlx_lm will run:")
    print("    " + " ".join(shlex.quote(c) for c in cmd))
    print("\n  PROVENANCE      : trains ONLY the validated open-model eri corpus (+ optional clean "
          "public blend). No teacher, no Claude/GPT.")
    print("  COST            : a real run downloads the 4-bit 32B (~18GB) once and trains for "
          "HOURS on an M-series. --dry-run does NEITHER.")
    print("\n  After training, chat with the adapter:")
    print(f"    python3 -m mlx_lm generate --model {mlx_cfg['model']} "
          f"--adapter-path {mlx_cfg['adapter_path']} --prompt \"hey eri\"")
    print("\n  DRY-RUN OK: data dir valid, config written, command planned. NO training ran.")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="eri-brain LoRA via MLX-LM (Apple Silicon).")
    ap.add_argument("--config", default=str(HERE / "config.yaml"), help="eri config.yaml")
    ap.add_argument("--model", default=None,
                    help=f"MLX base repo (default from config or {DEFAULT_MLX_MODEL})")
    ap.add_argument("--data", default=None, help="MLX data dir (default <root>/mlx_data)")
    ap.add_argument("--adapter-path", default=None, help="adapter output (default <root>/adapters/eri-v1)")
    ap.add_argument("--mlx-config", default=None, help="where to write the generated mlx_lm config")
    ap.add_argument("--num-layers", type=int, default=None)
    ap.add_argument("--iters", type=int, default=None)
    ap.add_argument("--batch-size", type=int, default=None)
    ap.add_argument("--learning-rate", type=float, default=None)
    ap.add_argument("--max-seq-length", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true",
                    help="validate data + print command + write config; NO training/download/GPU")
    args = ap.parse_args(argv)

    root = Path(args.config).resolve().parent
    data_dir = Path(args.data).resolve() if args.data else (root / "mlx_data")
    adapter_path = Path(args.adapter_path).resolve() if args.adapter_path else (root / "adapters" / "eri-v1")
    mlx_config_file = Path(args.mlx_config).resolve() if args.mlx_config else (root / "mlx_data" / "lora_config.yaml")

    # Read eri config.yaml (for LoRA params + base id). Tolerate a missing/unparseable config in
    # dry-run by falling back to defaults so the gate never hard-fails on environment.
    cfg: dict | None = None
    config_path = Path(args.config)
    if config_path.exists() and HAVE_YAML:
        try:
            cfg = load_config(config_path)
        except Exception as e:  # noqa: BLE001 - dry-run must stay robust
            print(f"  note: could not parse {config_path} ({e}); using built-in defaults.",
                  file=sys.stderr)
    elif not HAVE_YAML:
        print("  note: pyyaml not installed — using built-in LoRA defaults (rank=16 scale=2.0 "
              "dropout=0.05). Install pyyaml to read config.yaml.", file=sys.stderr)

    # base model: --model > config.yaml base_id > Apple-native default.
    cfg_base = (cfg or {}).get("model", {}).get("base_id") if cfg else None
    model = args.model or cfg_base or DEFAULT_MLX_MODEL
    # If the config points at the bf16 HF repo, prefer the MLX 4-bit build unless the user overrides.
    if model == "Qwen/Qwen3-32B" and not args.model:
        model = DEFAULT_MLX_MODEL

    overrides = {k: v for k, v in {
        "num_layers": args.num_layers, "iters": args.iters, "batch_size": args.batch_size,
        "learning_rate": args.learning_rate, "max_seq_length": args.max_seq_length,
    }.items() if v is not None}

    mlx_cfg = derive_mlx_config(cfg, model, data_dir, adapter_path, overrides)

    try:
        data_stats = validate_data_dir(data_dir)
    except FileNotFoundError as e:
        print(f"DATA CHECK FAILED: {e}", file=sys.stderr)
        return 1

    write_mlx_config(mlx_config_file, mlx_cfg)
    cmd = build_command(mlx_config_file)

    if args.dry_run:
        print_plan(mlx_cfg, cmd, data_stats, mlx_config_file, cfg)
        return 0

    # Real run: shell out to mlx_lm.lora. Heavy + long. Requires `pip install mlx-lm` on Apple Silicon.
    print("== running mlx_lm.lora (this downloads the base once and trains for HOURS) ==")
    print("  " + " ".join(shlex.quote(c) for c in cmd))
    try:
        proc = subprocess.run(cmd, check=False)
    except FileNotFoundError:
        print("FATAL: mlx_lm not found. Install it on Apple Silicon: `pip install mlx-lm`.",
              file=sys.stderr)
        return 2
    if proc.returncode != 0:
        print(f"mlx_lm.lora exited with code {proc.returncode}", file=sys.stderr)
        return proc.returncode
    print(f"\nDONE. LoRA adapter saved to {adapter_path}")
    print(f"Chat with it: python3 -m mlx_lm generate --model {model} "
          f"--adapter-path {adapter_path} --prompt \"hey eri\"")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
