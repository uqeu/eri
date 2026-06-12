#!/usr/bin/env python3
"""Which local model is best for eri? Run the candidates through the scorer.

Mirrors crates/eri_cli/src/local_eval.rs::score_task (all expected substrings
present, case-insensitive). Hits a local Ollama server — no cloud, no login.
Auto-detects installed models, scores each on eri's Tier-1 task surface, and
prints a ranked verdict (accuracy primary, speed the tie-break). The candle
session swaps the transport; the scoring is identical.
"""
import json
import subprocess
import time
import urllib.request

OLLAMA = "http://localhost:11434"
SYSTEM = "You are eri. Answer in as few words as possible. No explanation."

# eri's Tier-1 low-level surface, graded by substring (model-agnostic).
TASKS = [
    ("Reply with ONLY the macOS app for: 'I want to watch a video'.", ["youtube"]),
    ("User: 'open spotify and play jazz'. Which app opens? One word.", ["spotify"]),
    ("User wants to quit Spotify. The action verb, one word?", ["quit"]),
    ("What is 17 times 3? Only the number.", ["51"]),
    ("Is 'delete all my files' a destructive action? yes or no.", ["yes"]),
    ("Is Paris the capital of France? yes or no.", ["yes"]),
    ("One-word sentiment of 'I absolutely love this!': positive or negative?", ["positive"]),
    ("Classify 'fix the typo in README' as one of: chat, edit, build.", ["edit"]),
    ("Classify 'build me a landing page' as one of: chat, edit, build.", ["build"]),
    ("Classify 'what's the weather today' as one of: chat, edit, build.", ["chat"]),
    ("Extract the email from: 'message john@acme.com about the demo'.", ["john@acme.com"]),
    ("A 3-hour report vs a 5-minute reply due now. Do which first? report or reply.", ["reply"]),
]


def installed_models() -> list[str]:
    out = subprocess.run(["ollama", "list"], capture_output=True, text=True).stdout
    return [ln.split()[0] for ln in out.splitlines()[1:] if ln.strip()]


def ask(model: str, prompt: str) -> tuple[str, float]:
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
        "stream": False,
        "options": {"num_predict": 256, "temperature": 0.0},
    }).encode()
    req = urllib.request.Request(
        f"{OLLAMA}/api/chat", data=body, headers={"content-type": "application/json"}
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.loads(r.read())
    return data.get("message", {}).get("content", ""), time.time() - t0


def score(answer: str, expect: list[str]) -> bool:
    low = answer.lower()
    return all(e.lower() in low for e in expect)


def main() -> None:
    models = installed_models()
    results = []
    demo = []  # full per-task data for the morph demo
    for model in models:
        passed, secs = 0, 0.0
        rows = []
        print(f"\n== {model} ==")
        for prompt, expect in TASKS:
            try:
                answer, dt = ask(model, prompt)
            except Exception as e:  # noqa: BLE001
                print(f"  ERR  {expect}: {e}")
                continue
            secs += dt
            ok = score(answer, expect)
            passed += ok
            clean = " ".join(answer.split())
            rows.append({"prompt": prompt, "expect": expect, "answer": clean,
                         "pass": ok, "secs": round(dt, 2)})
            print(f"  {'PASS' if ok else 'FAIL'}  {expect}  ({dt:.1f}s)  {clean[:60]!r}")
        n = len(TASKS)
        results.append((model, passed, n, secs))
        demo.append({"model": model, "passed": passed, "total": n,
                     "secs": round(secs, 1), "tasks": rows})
        print(f"  SCORE {passed}/{n}   {secs:.0f}s   {secs / n:.1f}s/task")

    with open("scripts/eval/results.json", "w", encoding="utf-8") as f:
        json.dump(demo, f, indent=2)
    print("\nwrote scripts/eval/results.json (full data for the morph demo)")

    print("\n" + "=" * 56)
    print(f"{'MODEL':<22}{'SCORE':>7}{'/TASK':>9}{'  RANK (acc, then speed)'}")
    print("-" * 56)
    # Rank: accuracy desc, then latency asc.
    for i, (m, p, n, s) in enumerate(
        sorted(results, key=lambda r: (-r[1] / r[2], r[3])), 1
    ):
        print(f"{m:<22}{p}/{n:<5}{s / n:>7.1f}s   #{i}")


if __name__ == "__main__":
    main()
