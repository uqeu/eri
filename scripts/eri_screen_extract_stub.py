#!/usr/bin/env python3
"""eri screen-extractor sidecar — STUB.

This is a *placeholder* capture sidecar. It emits a small SAMPLE element list so
the Rust `ScreenExtractService` pipeline (parse → fuse → Set-of-Mark) is
exercisable end-to-end today, without any on-device capture.

================================ TODO (on-device) ============================
Replace this stub with the real macOS-native Swift sidecar. eri only EXTRACTS;
Claude REASONS over the marked screenshot + element list. The real capture is:

  1. Capture   — ScreenCaptureKit: focus-free window/screen grab.
  2. AX harvest — AXUIElement walk: role + name + bounds + value. The PRIMARY,
                  token-cheap signal (gap: ~40% of apps expose no AX —
                  Electron/canvas/custom-drawn).
  3. OCR        — Apple Vision VNRecognizeTextRequest (.accurate): text + boxes
                  for what AX missed. System framework, ANE-accelerated.
  4. Vision gap-fill — a permissive interactable detector for what AX missed
                  (Florence-2 MIT, or a Screen2AX-style YOLOv11 retrained off
                  AGPL). The license-clean LocateAnything replacement.

Blueprint to PORT: Peekaboo (MIT, Swift — ScreenCaptureKit + AX + ScreenCapture,
ships as CLI/MCP): https://github.com/openclaw/Peekaboo
Shippable licenses only: Apple Vision (system), Florence-2 (MIT), RapidOCR
(Apache), Peekaboo (MIT). DO NOT ship LocateAnything (NVIDIA non-commercial +
CUDA) or OmniParser's YOLO detector (AGPL).

Contract (unchanged when the Swift sidecar lands): emit ONE JSON object per
line on stdout. A frame line is:

  {"type":"frame",
   "ax":     [ <ScreenElement>, ... ],
   "ocr":    [ <ScreenElement>, ... ],
   "vision": [ <ScreenElement>, ... ]}

where each ScreenElement is:

  {"role":"button", "label":"Submit", "interactable":true,
   "text":"Submit", "source":"ax",
   "bbox":{"x":0.1,"y":0.2,"w":0.3,"h":0.05}}   # all coords normalised [0,1]

`source` is one of "ax" | "ocr" | "vision". The Rust side assigns ids, fuses
the three streams (AX wins geometry/role; OCR/Vision fill labels), numbers the
interactables (Set-of-Mark), and hands the result to Claude. The raw frame
pixels NEVER cross into Rust — only this structured data does.
=============================================================================
"""

import argparse
import json
import sys


def emit(event):
    """Write one JSON object per line, flushed — the line-delimited contract."""
    sys.stdout.write(json.dumps(event, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def sample_frame():
    """A tiny synthetic screen: a heading, a Submit button (seen by both AX and
    OCR so the Rust fuser dedupes them), and a Docs link AX missed but Vision
    caught. Mirrors what the real AX/OCR/Vision streams will look like."""
    return {
        "type": "frame",
        "ax": [
            {
                "role": "button",
                "label": "",
                "interactable": True,
                "source": "ax",
                "bbox": {"x": 0.10, "y": 0.20, "w": 0.20, "h": 0.06},
            }
        ],
        "ocr": [
            {
                "role": "text",
                "label": "Welcome back",
                "interactable": False,
                "text": "Welcome back",
                "source": "ocr",
                "bbox": {"x": 0.10, "y": 0.05, "w": 0.40, "h": 0.04},
            },
            {
                # Same box as the AX button — the fuser merges these into one,
                # with the AX geometry/role and this OCR label.
                "role": "text",
                "label": "Submit",
                "interactable": False,
                "text": "Submit",
                "source": "ocr",
                "bbox": {"x": 0.11, "y": 0.20, "w": 0.18, "h": 0.06},
            },
        ],
        "vision": [
            {
                "role": "link",
                "label": "Docs",
                "interactable": True,
                "source": "vision",
                "bbox": {"x": 0.60, "y": 0.20, "w": 0.12, "h": 0.05},
            }
        ],
    }


def main():
    parser = argparse.ArgumentParser(description="eri screen-extractor sidecar (STUB)")
    parser.add_argument(
        "--run",
        action="store_true",
        help="emit one sample frame and exit (the stub does not loop)",
    )
    args = parser.parse_args()

    if not args.run:
        emit({"type": "status", "message": "usage: eri_screen_extract_stub.py --run"})
        return 0

    # The real sidecar streams a frame per capture; the stub emits one and
    # exits so tests are deterministic and fast.
    emit(sample_frame())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
