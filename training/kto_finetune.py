#!/usr/bin/env python3
"""eri per-user KTO finetune — the personalization objective the papers prescribe.

The audit (docs/training-audit.md) was blunt: SFT-only trains restraint the WRONG
way; the paper-backed objective is KTO (Kahneman-Tversky Optimization), which
learns from the BINARY accept/reject signal we now log in `behavioral_signals`
(kept = desirable, rejected/corrected = undesirable) — no paired preferences
needed. This is the loop that gives each user their own adapter WITHOUT one
person's style bleeding into another's (per-user data → per-user LoRA).

INPUT: a JSONL export of `behavioral_signals` rows ({prompt, response, signal});
each maps to a TRL KTO example via `lora_finetune.signal_to_kto`.

  python3 training/kto_finetune.py --config training/config.yaml \
      --signals export.jsonl --dry-run     # no GPU: validates + counts kept/rejected
  python3 training/kto_finetune.py --config training/config.yaml \
      --signals export.jsonl                # real KTO LoRA (GPU)

DEFERRED BY DESIGN: this only pays off once there's real signal volume + a GPU.
Heavy ML imports live inside _train() so the file imports + dry-runs anywhere.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("FATAL: pyyaml required. `pip install pyyaml`", file=sys.stderr)
    sys.exit(2)

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from lora_finetune import signal_to_kto  # noqa: E402


def load_kto_examples(signals_path: Path) -> list[dict]:
    """Read the signals JSONL → TRL KTO examples ({prompt, completion, label}),
    dropping malformed rows. Pure-ish (file read only); the mapping is tested."""
    examples: list[dict] = []
    for line in signals_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        ex = signal_to_kto(row)
        if ex is not None:
            examples.append(ex)
    return examples


def _train(cfg: dict, examples: list[dict]) -> None:
    """Real KTO LoRA. Heavy imports local so the module imports without a GPU."""
    import torch  # noqa: F401
    from datasets import Dataset
    from peft import LoraConfig
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    from trl import KTOConfig, KTOTrainer

    model_id = cfg["model"]["base_id"]
    tok = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
    q = cfg["quantization"]
    bnb = BitsAndBytesConfig(
        load_in_4bit=q["load_in_4bit"],
        bnb_4bit_quant_type=q["bnb_4bit_quant_type"],
        bnb_4bit_use_double_quant=q["bnb_4bit_use_double_quant"],
        bnb_4bit_compute_dtype=getattr(torch, q["bnb_4bit_compute_dtype"]),
    )
    model = AutoModelForCausalLM.from_pretrained(
        model_id, quantization_config=bnb, trust_remote_code=True, device_map="auto"
    )
    lc = cfg["lora"]
    peft_cfg = LoraConfig(
        r=lc["r"], lora_alpha=lc["alpha"], lora_dropout=lc["dropout"],
        bias=lc["bias"], task_type=lc["task_type"], target_modules=lc["target_modules"],
    )
    k = cfg.get("kto", {})
    # beta: TRL default 0.1; tune on real data (the audit notes the 0.05–0.10
    # figure isn't sourceable, so we keep the documented default until measured).
    kto_cfg = KTOConfig(
        beta=k.get("beta", 0.1),
        output_dir=k.get("output_dir", "eri-kto-adapter"),
        per_device_train_batch_size=k.get("batch_size", 4),
        learning_rate=k.get("learning_rate", 5e-6),
        num_train_epochs=k.get("epochs", 1),
    )
    trainer = KTOTrainer(
        model=model, ref_model=None, args=kto_cfg,
        train_dataset=Dataset.from_list(examples), processing_class=tok, peft_config=peft_cfg,
    )
    trainer.train()
    trainer.save_model(kto_cfg.output_dir)
    print(f"KTO adapter saved to {kto_cfg.output_dir}")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="eri per-user KTO LoRA (binary accept/reject)")
    ap.add_argument("--config", type=Path, default=HERE / "config.yaml")
    ap.add_argument("--signals", type=Path, required=True, help="JSONL export of behavioral_signals")
    ap.add_argument("--dry-run", action="store_true", help="validate + count, no GPU")
    args = ap.parse_args(argv)

    cfg = yaml.safe_load(args.config.read_text(encoding="utf-8"))
    examples = load_kto_examples(args.signals)
    kept = sum(1 for e in examples if e["label"])
    rejected = len(examples) - kept
    print(f"KTO examples: {len(examples)} ({kept} kept / {rejected} rejected)")
    if not examples:
        print("No usable signal rows — let eri accrue accept/reject data first.", file=sys.stderr)
        return 1
    if args.dry_run:
        print("DRY-RUN OK: signal export valid. Re-run without --dry-run on a GPU.")
        return 0
    _train(cfg, examples)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
