#!/usr/bin/env python3
"""EyeGestures-based gaze sidecar for eri.

Replaces the hand-tuned iris-corner-ratio approach with EyeGestures v3
(NativeSensors/EyeGestures) which:
  * Runs MediaPipe Iris + scikit-learn Ridge regression under the hood
  * Requires a one-time calibration sweep (25 points)
  * Maps gaze to actual screen pixels after calibration

The sidecar emits JSONL events on stdout in the same shape as before:
  {"type":"status","message":"..."}
  {"type":"gaze","target":"...","x":0.5,"y":0.5,"confidence":0.8}
  {"type":"error","message":"..."}
Plus, during calibration only:
  {"type":"calibrate","index":N,"total":25,"x":0.5,"y":0.5,"radius":80}

A fullscreen OpenCV window is used for the calibration dot sweep.
Once 25 points are captured, the window closes and tracking begins.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent

os.environ.setdefault("MPLCONFIGDIR", str(ROOT_DIR / ".cache" / "matplotlib"))
os.environ.setdefault("XDG_CACHE_HOME", str(ROOT_DIR / ".cache"))
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")
os.makedirs(os.environ["MPLCONFIGDIR"], exist_ok=True)

try:
    import cv2
    import numpy as np
    from eyeGestures import EyeGestures_v3  # type: ignore
except Exception as error:  # pragma: no cover - environment specific
    print(
        json.dumps(
            {
                "type": "error",
                "message": (
                    "EyeGestures dependencies missing. Run: script/eri_gaze_setup. "
                    f"Detail: {error}"
                ),
            }
        ),
        flush=True,
    )
    raise SystemExit(1) from error


CALIBRATION_POINTS = 25


def emit(event: dict[str, Any]) -> None:
    print(json.dumps(event, separators=(",", ":")), flush=True)


def detect_screen_size() -> tuple[int, int]:
    """Best-effort screen size for the primary display. Falls back to 1920x1200."""
    try:
        result = subprocess.run(
            [
                "osascript",
                "-e",
                "tell application \"Finder\" to get bounds of window of desktop",
            ],
            capture_output=True,
            text=True,
            timeout=2,
        )
        if result.returncode == 0:
            bounds = result.stdout.strip().split(",")
            if len(bounds) == 4:
                width = int(float(bounds[2]))
                height = int(float(bounds[3]))
                if width > 0 and height > 0:
                    return width, height
    except Exception:
        pass
    return 1920, 1200


def make_calibration_map(n_points: int) -> np.ndarray:
    """Shuffled grid of normalized coords in [0.08, 0.92]."""
    grid = np.arange(0.08, 0.95, 0.18)  # ~5 stops per axis
    xx, yy = np.meshgrid(grid, grid)
    points = np.column_stack([xx.ravel(), yy.ravel()])
    rng = np.random.default_rng(seed=int(time.time()))
    rng.shuffle(points)
    return points[:n_points]


def draw_calibration_frame(
    width: int,
    height: int,
    point: tuple[float, float],
    radius: int,
    progress: float,
) -> np.ndarray:
    canvas = np.zeros((height, width, 3), dtype=np.uint8)
    canvas[:] = (12, 12, 14)
    cx, cy = int(point[0] * width), int(point[1] * height)
    cv2.circle(canvas, (cx, cy), radius + 14, (120, 190, 255), 1, cv2.LINE_AA)
    cv2.circle(canvas, (cx, cy), 14, (120, 190, 255), -1, cv2.LINE_AA)
    bar_w = int(width * 0.4)
    bar_x = (width - bar_w) // 2
    bar_y = height - 80
    cv2.rectangle(canvas, (bar_x, bar_y), (bar_x + bar_w, bar_y + 10), (60, 60, 60), -1)
    cv2.rectangle(
        canvas,
        (bar_x, bar_y),
        (bar_x + int(bar_w * progress), bar_y + 10),
        (120, 190, 255),
        -1,
    )
    cv2.putText(
        canvas,
        "Look at each dot for ~1 second. ESC to cancel.",
        (bar_x, bar_y - 18),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (200, 200, 220),
        1,
        cv2.LINE_AA,
    )
    return canvas


def run(camera_index: int) -> int:
    screen_width, screen_height = detect_screen_size()
    emit(
        {
            "type": "status",
            "message": f"EyeGestures sidecar starting. Screen detected: {screen_width}x{screen_height}.",
        }
    )

    capture = cv2.VideoCapture(camera_index)
    if not capture.isOpened():
        emit({"type": "error", "message": f"Could not open camera index {camera_index}."})
        return 1

    gestures = EyeGestures_v3()
    try:
        gestures.setFixation(1.0)
    except Exception:
        pass
    calibration_map = make_calibration_map(CALIBRATION_POINTS)
    gestures.uploadCalibrationMap(calibration_map, context="eri")

    calibration_window = "eri gaze calibration"
    cv2.namedWindow(calibration_window, cv2.WINDOW_NORMAL)
    cv2.setWindowProperty(
        calibration_window, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN
    )
    emit(
        {
            "type": "status",
            "message": "Calibrating gaze: look at each glowing dot for ~1 second (ESC cancels).",
        }
    )

    captured = 0
    last_point_key: tuple[float, float] | None = None
    canceled = False
    while captured < CALIBRATION_POINTS and not canceled:
        ok, frame = capture.read()
        if not ok:
            continue
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb = np.flip(rgb, axis=1)
        try:
            event, cal = gestures.step(rgb, True, screen_width, screen_height, context="eri")
        except Exception as error:
            emit({"type": "error", "message": f"calibration step failed: {error}"})
            cv2.destroyAllWindows()
            capture.release()
            return 1
        if cal is None:
            continue
        point = (float(cal.point[0] / screen_width), float(cal.point[1] / screen_height))
        if last_point_key != point:
            last_point_key = point
            captured += 1
            emit(
                {
                    "type": "calibrate",
                    "index": captured,
                    "total": CALIBRATION_POINTS,
                    "x": point[0],
                    "y": point[1],
                    "radius": int(getattr(cal, "acceptance_radius", 60)),
                }
            )
        progress = captured / max(1, CALIBRATION_POINTS)
        canvas = draw_calibration_frame(
            screen_width,
            screen_height,
            point,
            int(getattr(cal, "acceptance_radius", 60)),
            progress,
        )
        cv2.imshow(calibration_window, canvas)
        key = cv2.waitKey(1) & 0xFF
        if key == 27:
            canceled = True
            break

    cv2.destroyWindow(calibration_window)
    if canceled:
        emit({"type": "status", "message": "Calibration cancelled. Falling back to uncalibrated tracking."})
    else:
        emit(
            {
                "type": "status",
                "message": "Calibration complete. Streaming gaze in screen coordinates.",
            }
        )

    last_emit = 0.0
    while True:
        ok, frame = capture.read()
        if not ok:
            emit({"type": "error", "message": "Camera frame read failed."})
            return 1
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb = np.flip(rgb, axis=1)
        try:
            event, _cal = gestures.step(rgb, False, screen_width, screen_height, context="eri")
        except Exception as error:
            emit({"type": "error", "message": f"tracking step failed: {error}"})
            continue
        if event is None:
            continue
        now = time.monotonic()
        if now - last_emit < 0.06:
            continue
        last_emit = now
        x = float(event.point[0]) / max(1, screen_width)
        y = float(event.point[1]) / max(1, screen_height)
        confidence = float(getattr(event, "fixation", 0.7) or 0.7)
        emit(
            {
                "type": "gaze",
                "target": "screen",
                "label": "EyeGestures v3",
                "x": round(max(0.0, min(1.0, x)), 4),
                "y": round(max(0.0, min(1.0, y)), 4),
                "confidence": round(max(0.0, min(1.0, confidence)), 3),
            }
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument(
        "--preview", action="store_true", help="No-op for compatibility (calibration uses fullscreen)."
    )
    args = parser.parse_args()

    if not args.run:
        emit(
            {
                "type": "status",
                "message": "Usage: script/eri_gaze_sidecar --run",
            }
        )
        return 0

    return run(args.camera)


if __name__ == "__main__":
    raise SystemExit(main())
