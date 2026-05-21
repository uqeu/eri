#!/usr/bin/env python3
"""ElevenLabs TTS sidecar for eri — minimal version.

Mirrors the canonical ElevenLabs SDK call:
    client.text_to_speech.convert(voice_id, text, model_id, output_format)
then plays the returned MP3 via macOS `afplay`. No streaming, no fades, no
voice_settings — just the basic call that matches the website's behavior.

Run:
    .venv-tts/bin/python script/eri_tts_sidecar.py --run --port 8766

POST /speak with JSON body:
    {"text": "...", "voice": "<voice_id_or_name>"}
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import subprocess
import tempfile
import threading
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent

try:
    from dotenv import load_dotenv  # type: ignore

    load_dotenv(ROOT_DIR / ".env")
except Exception:
    pass

DEFAULT_VOICE = os.environ.get("ERI_TTS_VOICE", "gJx1vCzNCD1EQHT212Ls")
DEFAULT_MODEL = os.environ.get("ERI_TTS_MODEL", "eleven_multilingual_v2")
DEFAULT_OUTPUT_FORMAT = os.environ.get("ERI_TTS_FORMAT", "mp3_44100_128")


def emit(event: dict[str, Any]) -> None:
    print(json.dumps(event, separators=(",", ":")), flush=True)


class TtsEngine:
    """One ElevenLabs client + a serialized playback queue."""

    def __init__(self) -> None:
        api_key = (
            os.environ.get("ELEVENLABS_API_KEY")
            or os.environ.get("ELEVEN_API_KEY")
        )
        if not api_key:
            emit(
                {
                    "type": "error",
                    "message": (
                        "ELEVENLABS_API_KEY is not set. Add it to .env or "
                        "export it before running script/eri_tts_sidecar."
                    ),
                }
            )
            raise SystemExit(1)
        try:
            from elevenlabs.client import ElevenLabs  # type: ignore
        except Exception as error:
            emit(
                {
                    "type": "error",
                    "message": (
                        "elevenlabs is not installed in .venv-tts. "
                        "Run: script/eri_tts_setup"
                    ),
                    "detail": str(error),
                }
            )
            raise SystemExit(1) from error
        emit({"type": "status", "message": "Connecting to ElevenLabs."})
        self._client = ElevenLabs(api_key=api_key)
        # Optional library lookup so users can pass voice names like "ava"
        # instead of raw IDs. Failure is non-fatal.
        self._library: dict[str, str] = {}
        try:
            voices = self._client.voices.get_all().voices or []
            for v in voices:
                name = getattr(v, "name", None)
                vid = getattr(v, "voice_id", None)
                if name and vid:
                    self._library[name.strip().lower()] = vid
            emit(
                {
                    "type": "status",
                    "message": f"Loaded {len(self._library)} voices from your library.",
                }
            )
        except Exception as error:
            emit(
                {
                    "type": "status",
                    "message": f"Could not load voice library ({error}).",
                }
            )
        emit(
            {
                "type": "status",
                "message": (
                    f"ElevenLabs TTS ready ({DEFAULT_MODEL}, "
                    f"voice={DEFAULT_VOICE}, format={DEFAULT_OUTPUT_FORMAT})."
                ),
            }
        )
        self._play_lock = threading.Lock()
        # Queue entries: (audio_bytes, voice, char_count). char_count is the
        # ElevenLabs-billable length so the panel can render running $$ cost
        # for the "TTS chars" line. Older entries used `(bytes, voice)` —
        # keep tuple shape stable across releases.
        self._play_queue: queue.Queue[tuple[bytes, str, int]] = queue.Queue()
        self._current_proc: subprocess.Popen[bytes] | None = None
        threading.Thread(target=self._playback_loop, daemon=True).start()

    def _resolve_voice_id(self, voice: str) -> str:
        voice = (voice or "").strip() or DEFAULT_VOICE
        lowered = voice.lower()
        if lowered in self._library:
            return self._library[lowered]
        return voice  # raw id pass-through

    def _playback_loop(self) -> None:
        while True:
            audio_bytes, voice, chars = self._play_queue.get()
            try:
                with tempfile.NamedTemporaryFile(
                    suffix=".mp3", delete=False
                ) as fh:
                    fh.write(audio_bytes)
                    path = fh.name
                with self._play_lock:
                    self._current_proc = subprocess.Popen(
                        ["afplay", path],
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    proc = self._current_proc
                proc.wait()
                with self._play_lock:
                    self._current_proc = None
                try:
                    os.unlink(path)
                except OSError:
                    pass
                emit({"type": "spoke", "voice": voice, "chars": chars})
            except Exception as error:
                emit({"type": "error", "message": f"playback failed: {error}"})

    def stop(self) -> None:
        with self._play_lock:
            proc = self._current_proc
            if proc is not None and proc.poll() is None:
                try:
                    proc.terminate()
                except Exception:
                    pass
        with self._play_queue.mutex:
            self._play_queue.queue.clear()

    def speak(self, text: str, voice: str) -> None:
        if not text.strip():
            return
        voice_id = self._resolve_voice_id(voice)
        emit(
            {
                "type": "status",
                "message": f"synthesizing voice_id={voice_id} text={text!r}",
            }
        )
        try:
            audio = self._client.text_to_speech.convert(
                voice_id=voice_id,
                text=text,
                model_id=DEFAULT_MODEL,
                output_format=DEFAULT_OUTPUT_FORMAT,
            )
            audio_bytes = b"".join(audio) if not isinstance(audio, bytes) else audio
        except Exception as error:
            emit(
                {
                    "type": "error",
                    "message": f"synth failed: {error}",
                    "detail": traceback.format_exc(),
                }
            )
            return
        if not audio_bytes:
            return
        self._play_queue.put((audio_bytes, voice, len(text)))


def build_handler(engine: TtsEngine):
    class TtsHandler(BaseHTTPRequestHandler):
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

            if self.path == "/speak":
                text = str(payload.get("text", "")).strip()
                voice = str(payload.get("voice", DEFAULT_VOICE)) or DEFAULT_VOICE
                threading.Thread(
                    target=engine.speak,
                    args=(text, voice),
                    daemon=True,
                ).start()
                body = json.dumps({"status": "queued"}).encode("utf-8")
                self.send_response(202)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            if self.path == "/stop":
                engine.stop()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status":"stopped"}')
                return

            self.send_error(404, "not found")

    return TtsHandler


def run(port: int) -> int:
    engine = TtsEngine()
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
            "message": f"TTS sidecar ready at http://{address[0]}:{address[1]}/speak",
        }
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        engine.stop()
        emit({"type": "status", "message": "TTS sidecar shutting down."})
        server.server_close()
        return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--port", type=int, default=int(os.environ.get("ERI_TTS_PORT", "8766")))
    args = parser.parse_args()
    if not args.run:
        emit({"type": "status", "message": "Usage: script/eri_tts_sidecar --run [--port 8766]"})
        return 0
    return run(args.port) or 0


if __name__ == "__main__":
    raise SystemExit(main())
