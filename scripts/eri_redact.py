#!/usr/bin/env python3
"""eri face-redaction sidecar — strip faces from a frame BEFORE it can leave
the machine.

Privacy filter for the ambient-awareness / computer-control vision path: any
screen frame that might be sent to a cloud vision model passes through here
first, so third-party faces (and the user's own) on screen are blurred/blacked
out locally. Runs fully on-device (MediaPipe BlazeFace + OpenCV) — no network,
no cloud, like the gaze sidecar.

DESIGN / LEGAL: this does face DETECTION + REDACTION only. It deliberately does
NOT do face *recognition* / identity matching — storing face embeddings is
biometric data (GDPR / BIPA / CUBI) and a liability we don't want in a shipping
product. We blur ALL faces uniformly; we never identify anyone.

Adapted from the user's Loom Analytics redaction engine (apply_redaction +
BlazeFace), reduced to the streaming single-frame case.

Usage:
  # one-shot file redaction (testing)
  python3 eri_redact.py --in shot.png --out shot.redacted.png [--style blur|black|pixelate]

  # streaming: read base64 PNG frames on stdin (one JSON per line), emit
  # {"image": "<base64 redacted png>", "faces": N} per line.
  python3 eri_redact.py --stdio
"""

from __future__ import annotations

import argparse
import base64
import json
import sys


def _lazy_imports():
    """Import heavy CV deps lazily so --help / syntax checks work without them."""
    import cv2  # type: ignore
    import numpy as np  # type: ignore
    import mediapipe as mp  # type: ignore

    return cv2, np, mp


# --- redaction primitives (ported from Loom apply_redaction) ----------------

def _redact_box(cv2, frame, x0, y0, x1, y1, style: str, intensity: int, padding: int):
    """Redact the bbox region in-place. Styles: blur, black, pixelate."""
    h, w = frame.shape[:2]
    # Pad + clamp to frame bounds.
    x0 = max(0, x0 - padding)
    y0 = max(0, y0 - padding)
    x1 = min(w, x1 + padding)
    y1 = min(h, y1 + padding)
    if x1 <= x0 or y1 <= y0:
        return
    roi = frame[y0:y1, x0:x1]
    if style == "black":
        frame[y0:y1, x0:x1] = 0
    elif style == "pixelate":
        # Downscale then nearest-neighbour upscale -> blocky.
        blocks = max(1, 16 - intensity)  # higher intensity -> bigger blocks
        small = cv2.resize(roi, (max(1, (x1 - x0) // blocks), max(1, (y1 - y0) // blocks)),
                           interpolation=cv2.INTER_LINEAR)
        frame[y0:y1, x0:x1] = cv2.resize(small, (x1 - x0, y1 - y0),
                                         interpolation=cv2.INTER_NEAREST)
    else:  # blur (default)
        # Kernel must be odd; scale with intensity + region size.
        ksize = max(3, (intensity * 6) | 1)
        frame[y0:y1, x0:x1] = cv2.GaussianBlur(roi, (ksize, ksize), 30)


class Redactor:
    """Holds the BlazeFace detector; redacts all faces in a BGR frame."""

    def __init__(self, min_confidence: float = 0.5):
        self.cv2, self.np, self.mp = _lazy_imports()
        # model_selection=1 = full-range model (better for faces farther away,
        # e.g. a webcam face visible inside the captured screen).
        self._fd = self.mp.solutions.face_detection.FaceDetection(
            model_selection=1, min_detection_confidence=min_confidence
        )

    def redact(self, frame, style: str = "blur", intensity: int = 5, padding: int = 6) -> int:
        """Blur every detected face in `frame` (BGR ndarray) in-place. Returns
        the number of faces redacted."""
        h, w = frame.shape[:2]
        rgb = self.cv2.cvtColor(frame, self.cv2.COLOR_BGR2RGB)
        result = self._fd.process(rgb)
        count = 0
        for det in (result.detections or []):
            box = det.location_data.relative_bounding_box
            x0 = int(box.xmin * w)
            y0 = int(box.ymin * h)
            x1 = int((box.xmin + box.width) * w)
            y1 = int((box.ymin + box.height) * h)
            _redact_box(self.cv2, frame, x0, y0, x1, y1, style, intensity, padding)
            count += 1
        return count


# --- entry points -----------------------------------------------------------

def _run_file(args) -> int:
    cv2, _np, _mp = _lazy_imports()
    frame = cv2.imread(args.infile)
    if frame is None:
        print(f"eri_redact: cannot read {args.infile}", file=sys.stderr)
        return 1
    n = Redactor(args.min_confidence).redact(frame, args.style, args.intensity, args.padding)
    cv2.imwrite(args.outfile, frame)
    print(f"eri_redact: redacted {n} face(s) -> {args.outfile}")
    return 0


def _run_stdio(args) -> int:
    cv2, np, _mp = _lazy_imports()
    redactor = Redactor(args.min_confidence)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            raw = base64.b64decode(req["image"])
            buf = np.frombuffer(raw, dtype=np.uint8)
            frame = cv2.imdecode(buf, cv2.IMREAD_COLOR)
            n = redactor.redact(frame, req.get("style", args.style),
                                req.get("intensity", args.intensity),
                                req.get("padding", args.padding))
            ok, enc = cv2.imencode(".png", frame)
            out = base64.b64encode(enc.tobytes()).decode("ascii") if ok else ""
            print(json.dumps({"image": out, "faces": n}))
        except Exception as e:  # never crash the stream on one bad frame
            print(json.dumps({"error": str(e)}))
        sys.stdout.flush()
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="eri local face-redaction sidecar")
    p.add_argument("--in", dest="infile", help="input image path")
    p.add_argument("--out", dest="outfile", help="output image path")
    p.add_argument("--stdio", action="store_true", help="stream base64 frames on stdin")
    p.add_argument("--style", default="blur", choices=["blur", "black", "pixelate"])
    p.add_argument("--intensity", type=int, default=5)
    p.add_argument("--padding", type=int, default=6)
    p.add_argument("--min-confidence", dest="min_confidence", type=float, default=0.5)
    args = p.parse_args()
    if args.stdio:
        return _run_stdio(args)
    if args.infile and args.outfile:
        return _run_file(args)
    p.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
