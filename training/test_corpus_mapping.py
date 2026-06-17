#!/usr/bin/env python3
"""Pure-logic tests for the corpus + KTO mappers (no torch/GPU/network).

Run: `python3 training/test_corpus_mapping.py`. These cover the bug the audit
flagged — the old loader concatenated raw, incompatible dataset rows — by proving
`to_messages` normalizes every common HF shape to the chat schema (or drops it),
and that `signal_to_kto` turns the behavioral_signals export into TRL KTO examples.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lora_finetune import signal_to_kto, to_messages  # noqa: E402


def test_to_messages() -> None:
    # native messages → passthrough (stringified roles/content)
    m = to_messages({"messages": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "yo"}]})
    assert m == [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "yo"}]

    # ShareGPT conversations → role-mapped
    m = to_messages({"conversations": [{"from": "human", "value": "q"}, {"from": "gpt", "value": "a"}]})
    assert m == [{"role": "user", "content": "q"}, {"role": "assistant", "content": "a"}]

    # instruction (+input) / output → user/assistant
    m = to_messages({"instruction": "Summarize", "input": "the text", "output": "done"})
    assert m == [{"role": "user", "content": "Summarize\n\nthe text"}, {"role": "assistant", "content": "done"}]

    # prompt + completion
    m = to_messages({"prompt": "2+2?", "completion": "4"})
    assert m == [{"role": "user", "content": "2+2?"}, {"role": "assistant", "content": "4"}]

    # question + answer
    m = to_messages({"question": "capital of France?", "answer": "Paris"})
    assert m and m[1]["content"] == "Paris"

    # unmappable → None (skipped, never trained raw)
    assert to_messages({"text": "just a blob"}) is None
    assert to_messages({"random": 1}) is None
    print("  to_messages: ok")


def test_signal_to_kto() -> None:
    kept = signal_to_kto({"prompt": "hey", "response": "hi there", "signal": "kept"})
    assert kept == {"prompt": "hey", "completion": "hi there", "label": True}

    rejected = signal_to_kto({"prompt": "hey", "response": "wrong", "signal": "rejected"})
    assert rejected and rejected["label"] is False

    # malformed / unknown signal → None
    assert signal_to_kto({"prompt": "", "response": "x", "signal": "kept"}) is None
    assert signal_to_kto({"prompt": "p", "response": "r", "signal": "weird"}) is None
    print("  signal_to_kto: ok")


if __name__ == "__main__":
    test_to_messages()
    test_signal_to_kto()
    print("test_corpus_mapping.py: all assertions passed")
