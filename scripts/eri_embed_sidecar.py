#!/usr/bin/env python3
"""Local embedding sidecar for eri.

Drop-in replacement for the OpenAI embeddings call used by the in-flight
`eri_index` crate. Runs `BAAI/bge-small-en-v1.5` (or
`sentence-transformers/all-MiniLM-L6-v2`) entirely on CPU — no API keys,
no network after first download.

Port 8769. The Rust side opts in by setting ``ERI_EMBED_LOCAL=1`` and
POSTing to ``http://127.0.0.1:8769/embed`` instead of api.openai.com.

Request:
    {"texts": ["chunk one", "chunk two", ...]}
Response:
    {"embeddings": [[...], [...]], "dim": 384, "model": "BAAI/bge-small-en-v1.5"}
"""

from __future__ import annotations

import argparse
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


BGE_MODEL = "BAAI/bge-small-en-v1.5"
MINILM_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


def emit(event: dict[str, Any]) -> None:
    print(json.dumps(event, separators=(",", ":")), flush=True)


def _pick_model() -> str:
    # `ERI_EMBED_MODEL` wins, then `ERI_EMBED_TIER`. Default is BGE (slightly
    # better recall) but MiniLM is faster on truly old CPUs.
    explicit = os.environ.get("ERI_EMBED_MODEL", "").strip()
    if explicit:
        return explicit
    tier = os.environ.get("ERI_EMBED_TIER", "default").strip().lower()
    if tier == "fast":
        return MINILM_MODEL
    return BGE_MODEL


class EmbedEngine:
    def __init__(self) -> None:
        try:
            from sentence_transformers import SentenceTransformer  # type: ignore
        except Exception as error:
            emit(
                {
                    "type": "error",
                    "message": (
                        "sentence-transformers not installed in .venv-lite. "
                        "Run: script/eri_lite_setup"
                    ),
                    "detail": str(error),
                }
            )
            raise SystemExit(1) from error

        model_id = _pick_model()
        emit({"type": "status", "message": f"Loading {model_id} (CPU)."})

        try:
            self.model = SentenceTransformer(model_id, device="cpu")
        except Exception as error:
            emit(
                {
                    "type": "error",
                    "message": f"Failed to load embed model: {error}",
                    "detail": traceback.format_exc(),
                }
            )
            raise SystemExit(1) from error

        self._lock = threading.Lock()
        self._model_label = model_id
        try:
            self._dim = int(self.model.get_sentence_embedding_dimension())
        except Exception:
            self._dim = 0
        emit({"type": "status", "message": f"embed ready (dim={self._dim})"})

    def encode(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        # Reject non-string entries early so we don't get a confusing
        # transformer error 30 seconds into the call.
        clean: list[str] = []
        for text in texts:
            if not isinstance(text, str):
                raise ValueError("texts must be a list of strings")
            clean.append(text)
        with self._lock:
            vectors = self.model.encode(
                clean,
                normalize_embeddings=True,
                convert_to_numpy=True,
                show_progress_bar=False,
            )
        return [vector.tolist() for vector in vectors]


def build_handler(engine: EmbedEngine):
    class EmbedHandler(BaseHTTPRequestHandler):
        def log_message(self, *_args: Any, **_kwargs: Any) -> None:
            return

        def do_GET(self):  # noqa: N802
            if self.path == "/health":
                body = json.dumps(
                    {
                        "status": "ok",
                        "model": engine._model_label,
                        "dim": engine._dim,
                    }
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

            if self.path != "/embed":
                self.send_error(404, "not found")
                return

            texts = payload.get("texts")
            if not isinstance(texts, list):
                self.send_error(400, "texts must be a list")
                return

            try:
                embeddings = engine.encode(texts)
            except ValueError as error:
                self.send_error(400, str(error))
                return
            except Exception as error:
                emit(
                    {
                        "type": "error",
                        "message": f"embed failed: {error}",
                        "detail": traceback.format_exc(),
                    }
                )
                self.send_error(500, f"embed failed: {error}")
                return

            emit({"type": "embedded", "count": len(embeddings), "dim": engine._dim})
            body = json.dumps(
                {
                    "embeddings": embeddings,
                    "dim": engine._dim,
                    "model": engine._model_label,
                }
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return EmbedHandler


def run(port: int) -> int:
    engine = EmbedEngine()
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
            "message": f"Embed sidecar ready at http://{address[0]}:{address[1]}/embed",
        }
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        emit({"type": "status", "message": "Embed sidecar shutting down."})
        server.server_close()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("ERI_EMBED_PORT", "8769")),
    )
    args = parser.parse_args()
    if not args.run:
        emit(
            {
                "type": "status",
                "message": "Usage: script/eri_embed_sidecar --run [--port 8769]",
            }
        )
        return 0
    return run(args.port) or 0


if __name__ == "__main__":
    raise SystemExit(main())
