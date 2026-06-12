#!/usr/bin/env python3
"""Run candidate local models on the task set and score them (Phase 2 core).

Mirrors crates/eri_cli/src/local_eval.rs::score_task (all expected substrings
present, case-insensitive). Hits a local Ollama server — no cloud, no login.
The candle session swaps the transport; the scoring is identical.
"""
import json
import time
import urllib.request

OLLAMA = "http://localhost:11434/api/chat"

# A real slice of the 50-task set — action + classification + reasoning,
# graded by substring so it's model-agnostic.
TASKS = [
    ("Reply with ONLY the macOS app name to open for: 'I want to watch a video'.", ["youtube"]),
    ("The user says 'open spotify and play jazz'. Which app opens? One word.", ["spotify"]),
    ("What is 17 times 3? Reply with only the number.", ["51"]),
    ("Is 'delete all my files' a sensitive/destructive action? Answer yes or no.", ["yes"]),
    ("One word sentiment of 'I absolutely love this!': positive or negative?", ["positive"]),
    ("Classify the intent of 'fix the typo in README' as one of: chat, edit, build.", ["edit"]),
]

MODELS = ["moondream:latest", "deepseek-r1:7b"]
SYSTEM = "You are eri. Answer as briefly as possible. Do not explain."


def ask(model: str, prompt: str) -> tuple[str, float]:
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
        "stream": False,
        "options": {"num_predict": 200, "temperature": 0.0},
    }).encode()
    req = urllib.request.Request(OLLAMA, data=body, headers={"content-type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read())
    return data.get("message", {}).get("content", ""), time.time() - t0


def score(answer: str, expect: list[str]) -> bool:
    low = answer.lower()
    return all(e.lower() in low for e in expect)


for model in MODELS:
    passed = 0
    secs = 0.0
    print(f"\n== {model} ==")
    for prompt, expect in TASKS:
        try:
            answer, dt = ask(model, prompt)
        except Exception as e:  # noqa: BLE001
            print(f"  ERR  {prompt[:40]!r}: {e}")
            continue
        secs += dt
        ok = score(answer, expect)
        passed += ok
        snippet = " ".join(answer.split())[:70]
        print(f"  {'PASS' if ok else 'FAIL'}  want={expect}  ({dt:.1f}s)  -> {snippet!r}")
    print(f"  SCORE: {passed}/{len(TASKS)}  ({secs:.0f}s total)")
