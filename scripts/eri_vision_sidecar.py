#!/usr/bin/env python3
"""Local VLM sidecar for eri (image -> textual description).

Used by the image-to-code path in eri_ui: instead of stuffing a raw data URL
into Mercury's prompt, we POST the image here, get a dense textual
description back, and pass *that* description (plus the original image, if
the user wants) to Mercury. This keeps the prompt cheap and lets weaker
laptops participate even when Mercury can't see images.

Port 8768. JSON over HTTP. No model weights are ever shipped — they download
on first run via Hugging Face Hub.

Model is picked from ``ERI_VISION_TIER``:

* ``light``   (default) → ``HuggingFaceTB/SmolVLM-256M-Instruct`` (~150 MB)
* ``default``           → ``vikhyatk/moondream2``                (~1 GB)

Both paths use `transformers` on CPU. We require `torch` to be available;
`eri_lite_setup` installs the CPU-only wheels.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import threading
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
os.environ.setdefault("HF_HOME", str(ROOT_DIR / ".cache" / "huggingface"))
os.environ.setdefault("TRANSFORMERS_CACHE", str(ROOT_DIR / ".cache" / "huggingface"))
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


LIGHT_MODEL = "HuggingFaceTB/SmolVLM-256M-Instruct"
DEFAULT_MODEL = "vikhyatk/moondream2"

DEFAULT_QUESTION = (
    "Describe the layout, color palette, typography, and key UI components "
    "of this screenshot in 4-6 sentences. Be specific so a code generator "
    "can rebuild it."
)


def emit(event: dict[str, Any]) -> None:
    print(json.dumps(event, separators=(",", ":")), flush=True)


def _pick_model() -> str:
    tier = os.environ.get("ERI_VISION_TIER", "light").strip().lower()
    if tier == "default":
        return DEFAULT_MODEL
    return LIGHT_MODEL


class VisionEngine:
    """Thin wrapper around `transformers` for the selected VLM."""

    def __init__(self) -> None:
        try:
            import torch  # noqa: F401  # type: ignore
            from PIL import Image  # noqa: F401  # type: ignore
            from transformers import AutoModelForVision2Seq, AutoProcessor  # type: ignore
        except Exception as error:
            emit(
                {
                    "type": "error",
                    "message": (
                        "transformers / torch / pillow not installed in .venv-lite. "
                        "Run: script/eri_lite_setup"
                    ),
                    "detail": str(error),
                }
            )
            raise SystemExit(1) from error

        self._torch = __import__("torch")
        self._Image = __import__("PIL.Image", fromlist=["Image"]).Image

        model_id = _pick_model()
        emit({"type": "status", "message": f"Loading {model_id} (CPU)."})

        try:
            self.processor = AutoProcessor.from_pretrained(
                model_id, trust_remote_code=True
            )
            self.model = AutoModelForVision2Seq.from_pretrained(
                model_id,
                trust_remote_code=True,
                torch_dtype=self._torch.float32,
            )
            # Switch into inference mode (transformers' standard call).
            self.model = self.model.eval()  # noqa: S307  # not Python's eval()
        except Exception as error:
            emit(
                {
                    "type": "error",
                    "message": f"Failed to load vision model: {error}",
                    "detail": traceback.format_exc(),
                }
            )
            raise SystemExit(1) from error

        self._lock = threading.Lock()
        self._model_label = model_id
        emit({"type": "status", "message": "vision ready"})

    def describe(self, image_b64: str, question: str) -> str:
        if not image_b64:
            raise ValueError("image_base64 is required")
        try:
            raw = base64.b64decode(image_b64, validate=False)
        except Exception as error:
            raise ValueError(f"image_base64 is not valid base64: {error}") from error

        image = self._Image.open(io.BytesIO(raw)).convert("RGB")
        prompt_text = question.strip() or DEFAULT_QUESTION

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image"},
                    {"type": "text", "text": prompt_text},
                ],
            }
        ]
        try:
            prompt = self.processor.apply_chat_template(
                messages, add_generation_prompt=True
            )
        except Exception:
            prompt = prompt_text

        with self._lock:
            inputs = self.processor(text=prompt, images=[image], return_tensors="pt")
            with self._torch.no_grad():
                generated = self.model.generate(
                    **inputs,
                    max_new_tokens=192,
                    do_sample=False,
                )
            decoded = self.processor.batch_decode(
                generated, skip_special_tokens=True
            )

        text = decoded[0] if decoded else ""
        if prompt_text and prompt_text in text:
            text = text.rsplit(prompt_text, 1)[-1]
        return text.strip()


def build_handler(engine: VisionEngine):
    class VisionHandler(BaseHTTPRequestHandler):
        def log_message(self, *_args: Any, **_kwargs: Any) -> None:
            return

        def do_GET(self):  # noqa: N802
            if self.path == "/health":
                body = json.dumps(
                    {"status": "ok", "model": engine._model_label}
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

            if self.path != "/describe":
                self.send_error(404, "not found")
                return

            image_b64 = str(payload.get("image_base64", "")).strip()
            question = str(payload.get("question", "")).strip()

            try:
                description = engine.describe(image_b64, question)
            except ValueError as error:
                self.send_error(400, str(error))
                return
            except Exception as error:
                emit(
                    {
                        "type": "error",
                        "message": f"describe failed: {error}",
                        "detail": traceback.format_exc(),
                    }
                )
                self.send_error(500, f"describe failed: {error}")
                return

            emit({"type": "described", "chars": len(description)})
            body = json.dumps({"description": description}).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return VisionHandler


def run(port: int) -> int:
    engine = VisionEngine()
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
            "message": f"Vision sidecar ready at http://{address[0]}:{address[1]}/describe",
        }
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        emit({"type": "status", "message": "Vision sidecar shutting down."})
        server.server_close()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("ERI_VISION_PORT", "8768")),
    )
    args = parser.parse_args()
    if not args.run:
        emit(
            {
                "type": "status",
                "message": "Usage: script/eri_vision_sidecar --run [--port 8768]",
            }
        )
        return 0
    return run(args.port) or 0


if __name__ == "__main__":
    raise SystemExit(main())
