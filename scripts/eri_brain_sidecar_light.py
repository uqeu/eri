#!/usr/bin/env python3
"""CPU-only lite brain sidecar for eri.

Same HTTP API as `eri_brain_sidecar.py` (port 8767, POST /chat, GET /health)
but uses `llama-cpp-python` with a tiny GGUF model that runs on **any** CPU —
Intel Macs, low-RAM Linux laptops, anything with python.

Model is picked from ``ERI_BRAIN_TIER``:

* ``light``   → ``HuggingFaceTB/SmolLM2-360M-Instruct`` (~210 MB Q4 GGUF)
* ``default`` → ``Qwen/Qwen2.5-0.5B-Instruct-GGUF``     (~330 MB Q4 GGUF)

The wrapper script ``eri_brain_sidecar`` decides whether to launch this file
or the mlx-backed one. This file is the fallback path; it must never assume
Apple Silicon or even a GPU.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
os.environ.setdefault("HF_HOME", str(ROOT_DIR / ".cache" / "huggingface"))
os.environ.setdefault("TRANSFORMERS_CACHE", str(ROOT_DIR / ".cache" / "huggingface"))
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


LIGHT_REPO = "HuggingFaceTB/SmolLM2-360M-Instruct-GGUF"
LIGHT_FILE = "smollm2-360m-instruct-q4_k_m.gguf"

DEFAULT_REPO = "Qwen/Qwen2.5-0.5B-Instruct-GGUF"
DEFAULT_FILE = "qwen2.5-0.5b-instruct-q4_k_m.gguf"

SYSTEM_PROMPT = (
    "You are eri, a voice-driven IDE. Reply with ONE short, casual "
    "acknowledgement (max 12 words). No questions, no explanations, no emojis. "
    "Match the event type's tone. For the 'deployed' event the context is a "
    "live URL — include it verbatim in the reply."
)

# A trimmed few-shot list — the lite model has a smaller context window so we
# keep the priming examples tight rather than re-using the 60+ shots from the
# mlx sidecar. The events accepted by the HTTP handler are the full set, the
# trimmed shots just hint at the tone.
FEW_SHOTS: list[tuple[str, str, str]] = [
    ("fire_start", "build a coffee shop landing page", "got it, building a coffee shop"),
    ("fire_done", "", "done, take a look"),
    ("ship_it", "", "shipping it"),
    ("deployed", "https://demo-7q2.vercel.app", "shipped, check https://demo-7q2.vercel.app"),
    ("unclear", "", "didn't catch that — try again"),
    ("error", "mercury timed out", "something broke, try again"),
    ("retry", "", "trying again"),
    ("recording_started", "", "recording"),
    ("recording_stopped", "", "demo saved"),
    ("rewrite_applied", "", "applied"),
    ("rewrite_rejected", "", "discarded"),
    ("cost_warning", "0.80 of 1.00", "almost at your spending limit"),
    ("cost_paused", "1.00 of 1.00", "paused, you hit your limit"),
    ("cost_resumed", "", "back on, spending resumed"),
    ("cost_limit_raised", "5.00", "raised the limit to 5 dollars"),
    ("voice_cloned", "", "got your voice, talking like you now"),
    ("integration_starting", "stripe", "adding stripe"),
    ("integration_done", "stripe", "payments live, test with 4242"),
    ("integration_failed", "", "integration failed — check the panel"),
    ("thread_generating", "", "writing thread"),
    ("thread_generated", "", "thread ready, say copy the thread"),
    ("thread_failed", "", "thread failed, try again"),
    ("thread_copied", "", "copied"),
    ("reverted_to_commit", "a1b2c3d add dark mode toggle", "rolled back to a1b2c3d, dark mode toggle"),
]


VALID_EVENTS = frozenset(
    {
        "fire_start",
        "fire_done",
        "ship_it",
        "deployed",
        "unclear",
        "error",
        "retry",
        "recording_started",
        "recording_stopped",
        "commit_made",
        "reverted_to_commit",
        "rewrite_applied",
        "rewrite_rejected",
        "cost_warning",
        "cost_paused",
        "cost_resumed",
        "cost_limit_raised",
        "voice_cloned",
        "integration_starting",
        "integration_done",
        "integration_failed",
        "thread_generating",
        "thread_generated",
        "thread_failed",
        "thread_copied",
    }
)


def emit(event: dict[str, Any]) -> None:
    print(json.dumps(event, separators=(",", ":")), flush=True)


def _pick_model() -> tuple[str, str]:
    tier = os.environ.get("ERI_BRAIN_TIER", "light").strip().lower()
    if tier == "default":
        return DEFAULT_REPO, DEFAULT_FILE
    return LIGHT_REPO, LIGHT_FILE


class LiteBrainEngine:
    """Wraps llama-cpp-python; pulls the GGUF from HF on first launch."""

    def __init__(self) -> None:
        try:
            from llama_cpp import Llama  # type: ignore
        except Exception as error:
            emit(
                {
                    "type": "error",
                    "message": (
                        "llama-cpp-python not installed in .venv-lite. "
                        "Run: script/eri_lite_setup"
                    ),
                    "detail": str(error),
                }
            )
            raise SystemExit(1) from error

        repo_id, filename = _pick_model()
        emit({"type": "status", "message": f"Loading {repo_id}/{filename} (CPU)."})

        # `Llama.from_pretrained` handles HF hub download + caching; we let the
        # env var HF_HOME point at .cache/huggingface so we share the cache
        # with the other sidecars.
        try:
            self.model = Llama.from_pretrained(
                repo_id=repo_id,
                filename=filename,
                n_ctx=2048,
                n_threads=max(1, (os.cpu_count() or 4) - 1),
                verbose=False,
            )
        except Exception as error:
            emit(
                {
                    "type": "error",
                    "message": f"Failed to load lite brain model: {error}",
                    "detail": traceback.format_exc(),
                }
            )
            raise SystemExit(1) from error

        self._lock = threading.Lock()
        self._model_label = f"{repo_id}/{filename}"
        emit({"type": "status", "message": "brain ready"})

    def chat(self, event: str, context: str) -> str:
        messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
        for shot_event, shot_context, shot_reply in FEW_SHOTS:
            user_line = f"event: {shot_event}"
            if shot_context:
                user_line += f"\ncontext: {shot_context}"
            messages.append({"role": "user", "content": user_line})
            messages.append({"role": "assistant", "content": shot_reply})

        user_line = f"event: {event}"
        if context:
            user_line += f"\ncontext: {context}"
        messages.append({"role": "user", "content": user_line})

        with self._lock:
            try:
                result = self.model.create_chat_completion(
                    messages=messages,
                    max_tokens=24,
                    temperature=0.7,
                )
            except Exception as error:
                emit(
                    {
                        "type": "error",
                        "message": f"create_chat_completion failed: {error}",
                        "detail": traceback.format_exc(),
                    }
                )
                raise

        try:
            text = result["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            text = ""
        cleaned = text.strip().splitlines()[0].strip() if text and text.strip() else ""
        if len(cleaned) >= 2 and cleaned[0] in {'"', "'"} and cleaned[-1] == cleaned[0]:
            cleaned = cleaned[1:-1].strip()
        return cleaned


def build_handler(engine: LiteBrainEngine):
    class BrainHandler(BaseHTTPRequestHandler):
        def log_message(self, *_args: Any, **_kwargs: Any) -> None:
            return

        def do_GET(self):  # noqa: N802
            if self.path == "/health":
                body = json.dumps(
                    {"status": "ok", "tier": "lite", "model": engine._model_label}
                ).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self.send_error(404, "not found")

        def do_POST(self):  # noqa: N802
            try:
                length = int(self.headers.get("content-length", "0"))
                raw = self.rfile.read(length) if length else b"{}"
                payload = json.loads(raw.decode("utf-8") or "{}")
            except Exception as error:
                self.send_error(400, f"invalid request: {error}")
                return

            if self.path != "/chat":
                self.send_error(404, "not found")
                return

            event = str(payload.get("event", "")).strip()
            context = str(payload.get("context", "")).strip()
            if event not in VALID_EVENTS:
                self.send_error(400, f"unknown event: {event!r}")
                return

            if event == "commit_made":
                # Silent — see the mlx sidecar for the full rationale.
                emit({"type": "silent", "event": event})
                body = json.dumps({"text": ""}).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            try:
                text = engine.chat(event, context)
            except Exception as error:
                self.send_error(500, f"chat failed: {error}")
                return

            emit({"type": "acked", "event": event, "text": text})
            body = json.dumps({"text": text}).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return BrainHandler


def run(port: int) -> int:
    engine = LiteBrainEngine()
    handler = build_handler(engine)
    address = ("127.0.0.1", port)
    try:
        server = HTTPServer(address, handler)
    except OSError as error:
        emit(
            {
                "type": "error",
                "message": f"could not bind {address[0]}:{address[1]}: {error}",
            }
        )
        return 1
    emit(
        {
            "type": "status",
            "message": f"Lite brain sidecar ready at http://{address[0]}:{address[1]}/chat",
        }
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        emit({"type": "status", "message": "Lite brain sidecar shutting down."})
        server.server_close()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("ERI_BRAIN_PORT", "8767")),
    )
    args = parser.parse_args()
    if not args.run:
        emit(
            {
                "type": "status",
                "message": "Usage: script/eri_brain_sidecar_light --run [--port 8767]",
            }
        )
        return 0
    return run(args.port) or 0


if __name__ == "__main__":
    raise SystemExit(main())
