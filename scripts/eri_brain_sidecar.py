#!/usr/bin/env python3
"""Local Llama-3.2-1B brain sidecar for eri.

Loads a 4-bit MLX Llama model on Apple Silicon and exposes a tiny HTTP API
so the Rust panel can request short conversational acknowledgements. All
inference happens locally inside this process — eri never leaves the box.

Run:
    .venv-brain/bin/python script/eri_brain_sidecar.py --run --port 8767

POST /chat with JSON body:
    {"event": "fire_start"|"fire_done"|"ship_it"|"deployed"|"unclear"|"error"
              |"retry"|"recording_started"|"recording_stopped"
              |"commit_made"|"reverted_to_commit"
              |"rewrite_applied"|"rewrite_rejected"
              |"cost_warning"|"cost_paused"|"cost_resumed"|"cost_limit_raised"
              |"voice_cloned"
              |"integration_starting"|"integration_done"|"integration_failed"
              |"thread_generating"|"thread_generated"|"thread_failed"
              |"thread_copied"
              |"tests_writing"|"tests_done"
              |"explaining"|"explained"
              |"refactoring"|"refactored"
              |"documenting"|"documented",
     "context": "..."}

The `commit_made` event is silent — eri MUST NOT speak after every iteration
or it would be unbearably chatty. We accept the event so the panel's call
site stays uniform and so future modes (e.g. "verbose commit narration")
can flip a flag without changing both sides.
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


MODEL_ID = "mlx-community/Llama-3.2-1B-Instruct-4bit"

SYSTEM_PROMPT = (
    "You are eri, a voice-driven IDE. Reply with ONE short, casual "
    "acknowledgement (max 12 words). No questions, no explanations, no emojis. "
    "Match the event type's tone. For the 'deployed' event the context is a "
    "live URL — include it verbatim in the reply."
)

FEW_SHOTS: list[tuple[str, str, str]] = [
    ("fire_start", "build a coffee shop landing page", "got it, building a coffee shop"),
    ("fire_start", "add dark mode toggle", "on it, wiring up dark mode"),
    ("fire_start", "refactor the auth flow", "cool, cleaning up auth"),
    ("fire_done", "", "done, take a look"),
    ("fire_done", "", "all set, check it out"),
    ("fire_done", "", "wrapped that up"),
    ("ship_it", "", "shipping it"),
    ("ship_it", "", "pushing now"),
    ("ship_it", "", "out the door"),
    ("deployed", "https://eri-app-abc123.vercel.app", "out the door, https://eri-app-abc123.vercel.app"),
    ("deployed", "https://my-site-xyz.vercel.app", "live at https://my-site-xyz.vercel.app"),
    ("deployed", "https://demo-7q2.vercel.app", "shipped, check https://demo-7q2.vercel.app"),
    ("unclear", "", "didn't catch that — try again"),
    ("unclear", "", "missed that, one more time"),
    ("unclear", "", "sorry, say it again"),
    ("error", "mercury timed out", "something broke, try again"),
    ("error", "voice synth crashed, restarting", "lost the voice, retrying"),
    ("error", "lost the mic, retrying", "mic dropped, picking it back up"),
    ("error", "mercury error", "lost the connection, retrying"),
    ("retry", "make the headline bigger", "trying again"),
    ("retry", "build a coffee shop landing page", "rerunning it"),
    ("retry", "", "trying again"),
    ("recording_started", "", "recording"),
    ("recording_started", "", "rolling"),
    ("recording_started", "", "capturing now"),
    ("recording_stopped", "/Users/x/Desktop/eri-demos/2025-01-15-10-30-00.mp4", "saved demo at /Users/x/Desktop/eri-demos/2025-01-15-10-30-00.mp4"),
    ("recording_stopped", "/Users/x/Desktop/eri-demos/clip.mp4", "demo saved"),
    ("recording_stopped", "", "demo saved"),
    ("reverted_to_commit", "a1b2c3d add dark mode toggle", "rolled back to a1b2c3d, dark mode toggle"),
    ("reverted_to_commit", "abc1234 iter 0007 make headline bigger", "back at iter 7, headline bigger"),
    ("reverted_to_commit", "deadbee iter 0003 coffee landing", "rolled back to the coffee landing"),
    # Inline rewrite ack / dismiss — fires when the user says "accept" /
    # "reject" on a Cursor-style ghost-text suggestion. Keep these terse:
    # the user is staring at the patch, they want confirmation, not a recap.
    ("rewrite_applied", "make this async", "applied"),
    ("rewrite_applied", "add error handling here", "patched"),
    ("rewrite_applied", "refactor this to use map", "done, mapped it"),
    ("rewrite_applied", "wrap this in a try block", "wrapped"),
    ("rewrite_applied", "", "applied"),
    ("rewrite_rejected", "make this async", "discarded"),
    ("rewrite_rejected", "add error handling here", "dropped"),
    ("rewrite_rejected", "", "discarded"),
    ("rewrite_rejected", "", "scrapped"),
    # Cost-guard acks. Keep these terse — the user already sees the dollar
    # numbers on the panel; the brain just confirms what changed so they
    # never wonder whether the cap fired.
    ("cost_warning", "0.80 of 1.00", "almost at your spending limit"),
    ("cost_warning", "1.60 of 2.00", "closing in on your cap"),
    ("cost_warning", "", "heads up, near your limit"),
    ("cost_paused", "1.00 of 1.00", "paused, you hit your limit, raise it or say resume"),
    ("cost_paused", "request 0.15 over cap 0.10", "request too pricey, raise the per-request cap"),
    ("cost_paused", "", "paused spending"),
    ("cost_resumed", "", "back on, spending resumed"),
    ("cost_resumed", "", "resumed"),
    ("cost_limit_raised", "5.00", "raised the limit to 5 dollars"),
    ("cost_limit_raised", "2.50", "limit's now 2 dollars 50"),
    ("cost_limit_raised", "", "limit raised"),
    # Voice-clone wizard handoff. Context is the new voice_id but we never
    # speak it back — the user wants the punchline, not a UUID.
    ("voice_cloned", "abc123", "all set, now sounding like you"),
    ("voice_cloned", "", "got your voice, talking like you now"),
    ("voice_cloned", "", "cloned, this is you"),
    # Integration scaffolding (Auth0 / Clerk / Supabase / Neon / Stripe).
    # Context is the provider slug. Spoken acks stay terse — the user can
    # watch the panel log for the full Claude transcript and next-steps.
    ("integration_starting", "auth0", "wiring up auth0"),
    ("integration_starting", "clerk", "setting up clerk"),
    ("integration_starting", "supabase", "wiring up supabase"),
    ("integration_starting", "neon", "setting up postgres"),
    ("integration_starting", "stripe", "adding stripe"),
    ("integration_starting", "", "wiring it up"),
    ("integration_done", "auth0", "done, auth0 wired"),
    ("integration_done", "clerk", "clerk ready, log in to test"),
    ("integration_done", "supabase", "supabase connected"),
    ("integration_done", "neon", "db connected, check the env vars"),
    ("integration_done", "stripe", "payments live, test with 4242"),
    ("integration_done", "", "integration ready, check the panel"),
    ("integration_failed", "auth0", "auth0 setup failed, check the panel"),
    ("integration_failed", "stripe", "stripe setup hit an error, see the panel"),
    ("integration_failed", "", "integration failed — check the panel"),
    # Recording → social thread handoff. Context for `thread_generating` is
    # the project slug (so eri can say "writing thread for coffee shop");
    # `thread_generated` includes the tweet count so the user knows how much
    # they're about to paste; `thread_failed` carries a short reason string.
    ("thread_generating", "coffee-shop", "writing thread"),
    ("thread_generating", "", "writing thread"),
    ("thread_generated", "7", "thread ready, say copy the thread"),
    ("thread_generated", "6", "thread ready, say copy the thread"),
    ("thread_generated", "", "thread ready, say copy the thread"),
    ("thread_failed", "claude exited 1", "thread failed, try again"),
    ("thread_failed", "", "thread failed, try again"),
    ("thread_copied", "7", "copied"),
    ("thread_copied", "", "copied"),
    # Cursor-style code-assist (write tests / explain / refactor / document).
    # The `explained` event is silent — the explanation IS the speech, the
    # panel pipes Claude's prose straight into the TTS sidecar, so a brain
    # ack on top would just step on it. Other events get a terse confirmation
    # so the user knows the background job started / finished.
    ("tests_writing", "", "writing tests"),
    ("tests_writing", "billing.py", "writing tests for billing"),
    ("tests_writing", "Counter.tsx", "writing tests for counter"),
    ("tests_done", "", "tests ready, check the file"),
    ("tests_done", "billing.test.py", "tests ready, check the file"),
    ("tests_done", "Counter.test.tsx", "tests ready, check the file"),
    ("explaining", "", "let me see"),
    ("explaining", "", "taking a look"),
    ("explaining", "", "reading it"),
    ("refactoring", "", "cleaning up"),
    ("refactoring", "use map instead of a for loop", "cleaning up"),
    ("refactoring", "use async await", "cleaning up"),
    ("refactored", "", "done"),
    ("refactored", "", "cleaned up"),
    ("documenting", "", "adding docs"),
    ("documenting", "jsdoc", "adding jsdoc"),
    ("documenting", "rustdoc", "adding rustdoc"),
    ("documenting", "docstring", "adding docstrings"),
    ("documented", "", "documented"),
    ("documented", "jsdoc", "jsdoc added"),
    ("documented", "rustdoc", "rustdoc added"),
]


def emit(event: dict[str, Any]) -> None:
    print(json.dumps(event, separators=(",", ":")), flush=True)


class BrainEngine:
    """Loads Llama-3.2-1B-Instruct-4bit via mlx_lm and exposes chat()."""

    def __init__(self) -> None:
        try:
            from mlx_lm import load, generate  # type: ignore
        except Exception as error:  # pragma: no cover - environment specific
            emit(
                {
                    "type": "error",
                    "message": (
                        "mlx_lm is not installed in .venv-brain. "
                        "Run: script/eri_brain_setup"
                    ),
                    "detail": str(error),
                }
            )
            raise SystemExit(1) from error
        self._generate = generate
        emit({"type": "status", "message": f"Loading {MODEL_ID}."})
        try:
            self.model, self.tokenizer = load(MODEL_ID)
        except Exception as error:  # pragma: no cover
            emit(
                {
                    "type": "error",
                    "message": f"Failed to load brain model: {error}",
                    "detail": traceback.format_exc(),
                }
            )
            raise SystemExit(1) from error
        self._generate_lock = threading.Lock()
        emit({"type": "status", "message": "brain ready"})

    def _build_prompt(self, event: str, context: str) -> str:
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

        try:
            return self.tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
        except Exception:
            # Fall back to a hand-rolled prompt if the tokenizer lacks a
            # chat template — the model still works without it.
            lines = [f"<|system|>\n{SYSTEM_PROMPT}"]
            for message in messages[1:]:
                lines.append(f"<|{message['role']}|>\n{message['content']}")
            lines.append("<|assistant|>\n")
            return "\n".join(lines)

    def chat(self, event: str, context: str) -> str:
        prompt = self._build_prompt(event, context)
        with self._generate_lock:
            try:
                text = self._generate(
                    self.model,
                    self.tokenizer,
                    prompt=prompt,
                    max_tokens=24,
                    temp=0.7,
                    verbose=False,
                )
            except TypeError:
                # Older/newer mlx_lm versions renamed `temp` → `temperature`.
                text = self._generate(
                    self.model,
                    self.tokenizer,
                    prompt=prompt,
                    max_tokens=24,
                    temperature=0.7,
                    verbose=False,
                )
        cleaned = text.strip().splitlines()[0].strip() if text.strip() else ""
        # Strip surrounding quotes the model sometimes adds.
        if len(cleaned) >= 2 and cleaned[0] in {'"', "'"} and cleaned[-1] == cleaned[0]:
            cleaned = cleaned[1:-1].strip()
        return cleaned


def build_handler(engine: BrainEngine):
    class BrainHandler(BaseHTTPRequestHandler):
        def log_message(self, *_args: Any, **_kwargs: Any) -> None:
            return

        def do_GET(self):  # noqa: N802
            if self.path == "/health":
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status":"ok"}')
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

            if self.path == "/chat":
                event = str(payload.get("event", "")).strip()
                context = str(payload.get("context", "")).strip()
                if event not in {
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
                    "tests_writing",
                    "tests_done",
                    "explaining",
                    "explained",
                    "refactoring",
                    "refactored",
                    "documenting",
                    "documented",
                }:
                    self.send_error(400, f"unknown event: {event!r}")
                    return
                # Silent events: accept them so the panel's hook surface is
                # uniform, but emit an empty `text` so the TTS sidecar never
                # vocalises. `commit_made` happens on every iteration — if
                # eri narrated each one, we'd never shut up. `explained` is
                # silent because the panel pipes Claude's explanation straight
                # through TTS — a brain ack on top would step on it.
                if event in {"commit_made", "explained"}:
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
                    emit(
                        {
                            "type": "error",
                            "message": f"chat failed: {error}",
                            "detail": traceback.format_exc(),
                        }
                    )
                    self.send_error(500, f"chat failed: {error}")
                    return
                emit({"type": "acked", "event": event, "text": text})
                body = json.dumps({"text": text}).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            self.send_error(404, "not found")

    return BrainHandler


def run(port: int) -> int:
    engine = BrainEngine()
    handler = build_handler(engine)
    address = ("127.0.0.1", port)
    try:
        server = HTTPServer(address, handler)
    except OSError as error:
        emit({"type": "error", "message": f"could not bind {address[0]}:{address[1]}: {error}"})
        return 1
    emit(
        {
            "type": "status",
            "message": f"Brain sidecar ready at http://{address[0]}:{address[1]}/chat",
        }
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        emit({"type": "status", "message": "Brain sidecar shutting down."})
        server.server_close()
        return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--port", type=int, default=int(os.environ.get("ERI_BRAIN_PORT", "8767")))
    args = parser.parse_args()
    if not args.run:
        emit({"type": "status", "message": "Usage: script/eri_brain_sidecar --run [--port 8767]"})
        return 0
    return run(args.port) or 0


if __name__ == "__main__":
    raise SystemExit(main())
