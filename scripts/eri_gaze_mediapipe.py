#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# Calibration helpers (ridge regressor, 1€ filter, profile I/O) live in their
# own dependency-light module so they stay camera-free unit-testable.
import eri_gaze_calibration as calib  # noqa: E402

os.environ.setdefault("MPLCONFIGDIR", os.path.join(ROOT_DIR, ".cache", "matplotlib"))
os.environ.setdefault("XDG_CACHE_HOME", os.path.join(ROOT_DIR, ".cache"))
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")

try:
    os.makedirs(os.environ["MPLCONFIGDIR"], exist_ok=True)
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_tasks
    from mediapipe.tasks.python import vision
except Exception as error:
    print(
        json.dumps(
            {
                "type": "error",
                "message": f"MediaPipe gaze dependencies are missing: {error}",
            }
        ),
        flush=True,
    )
    raise SystemExit(1)


# MediaPipe FaceMesh landmark indices (478-point Iris model).
# Eye corners and lids — we need top/bottom so the iris Y is measured
# relative to the eye, not relative to the image (otherwise vertical gaze
# is dominated by head height in the frame, which barely changes).
LEFT_EYE_OUTER = 33
LEFT_EYE_INNER = 133
LEFT_EYE_TOP = 159
LEFT_EYE_BOTTOM = 145
LEFT_IRIS = (468, 469, 470, 471, 472)

RIGHT_EYE_INNER = 362
RIGHT_EYE_OUTER = 263
RIGHT_EYE_TOP = 386
RIGHT_EYE_BOTTOM = 374
RIGHT_IRIS = (473, 474, 475, 476, 477)


def emit(event):
    print(json.dumps(event, separators=(",", ":")), flush=True)


def average_landmarks(landmarks, indices):
    x = sum(landmarks[index].x for index in indices) / len(indices)
    y = sum(landmarks[index].y for index in indices) / len(indices)
    return x, y


def eye_xy_ratio(landmarks, inner_idx, outer_idx, top_idx, bottom_idx, iris_indices):
    """Return (x_ratio, y_ratio) of the iris within the eye's bounding box.

    0 = iris at left/top of the eye, 1 = iris at right/bottom of the eye.
    """
    iris_x, iris_y = average_landmarks(landmarks, iris_indices)
    inner = landmarks[inner_idx]
    outer = landmarks[outer_idx]
    top = landmarks[top_idx]
    bottom = landmarks[bottom_idx]
    min_x = min(inner.x, outer.x)
    max_x = max(inner.x, outer.x)
    min_y = min(top.y, bottom.y)
    max_y = max(top.y, bottom.y)
    width = max(max_x - min_x, 1e-6)
    height = max(max_y - min_y, 1e-6)
    return (iris_x - min_x) / width, (iris_y - min_y) / height


def clamp(value, lower=0.0, upper=1.0):
    return max(lower, min(upper, value))


def magic_map(raw_x, raw_y):
    """Legacy population-average mapping — the fail-safe fallback.

    Used only when no per-user calibration profile exists. The constants are a
    geometric guess (iris sweeps ~0.3..0.7 inside the eye box); see the gaze
    P0 calibration work for the regressor that supersedes this.
    """
    screen_x = clamp(0.5 - (raw_x - 0.5) * 3.2)
    screen_y = clamp((raw_y - 0.5) * 3.0 + 0.5)
    return screen_x, screen_y


def map_to_screen(raw_x, raw_y, profile):
    """Map raw iris ratios to screen [0,1] via the profile, else magic gains."""
    if profile is not None:
        return calib.profile_predict(profile, raw_x, raw_y)
    return magic_map(raw_x, raw_y)


def raw_gaze_from_landmarks(landmarks):
    """Average per-eye iris ratios into a single (raw_x, raw_y) feature pair.

    Returns ``None`` when iris landmarks are unavailable.
    """
    if len(landmarks) <= max(RIGHT_IRIS):
        return None
    left_x, left_y = eye_xy_ratio(
        landmarks,
        LEFT_EYE_INNER,
        LEFT_EYE_OUTER,
        LEFT_EYE_TOP,
        LEFT_EYE_BOTTOM,
        LEFT_IRIS,
    )
    right_x, right_y = eye_xy_ratio(
        landmarks,
        RIGHT_EYE_INNER,
        RIGHT_EYE_OUTER,
        RIGHT_EYE_TOP,
        RIGHT_EYE_BOTTOM,
        RIGHT_IRIS,
    )
    return (left_x + right_x) / 2.0, (left_y + right_y) / 2.0


def _open_landmarker(camera_index):
    """Open the camera + MediaPipe FaceLandmarker. Returns (capture, lm) or
    (None, None) after emitting an error event."""
    capture = cv2.VideoCapture(camera_index)
    if not capture.isOpened():
        emit({"type": "error", "message": f"Could not open camera index {camera_index}."})
        return None, None
    model_path = os.path.join(ROOT_DIR, "assets", "models", "face_landmarker.task")
    if not os.path.exists(model_path):
        emit({"type": "error", "message": f"Missing MediaPipe model: {model_path}"})
        capture.release()
        return None, None
    options = vision.FaceLandmarkerOptions(
        base_options=mp_tasks.BaseOptions(model_asset_path=model_path),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    return capture, vision.FaceLandmarker.create_from_options(options)


def _read_raw_sample(capture, landmarker):
    """Grab one frame and return its (raw_x, raw_y) gaze feature, or None."""
    ok, frame = capture.read()
    if not ok:
        return None
    frame = cv2.flip(frame, 1)
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = landmarker.detect_for_video(mp_image, int(time.monotonic() * 1000))
    if not result.face_landmarks:
        return None
    return raw_gaze_from_landmarks(result.face_landmarks[0])


def calibrate(camera_index, samples_per_target=20, settle_seconds=1.0):
    """Stdin-driven 9-point calibration.

    The Rust side (``gaze.rs``) owns pacing and on-screen target rendering. It
    sends one JSON control line per target on stdin:

        {"cmd": "target", "x": 0.1, "y": 0.1}   # capture this target now
        {"cmd": "finish"}                        # fit + persist, then exit
        {"cmd": "abort"}                         # discard, exit

    For each target we discard ``settle_seconds`` of frames (the user's eyes
    are still moving to the dot) then average ``samples_per_target`` features.
    We emit ``{"type":"calibration", ...}`` progress so the UI can advance.
    """
    capture, landmarker = _open_landmarker(camera_index)
    if capture is None:
        return 1
    emit({"type": "calibration", "phase": "ready",
          "targets": [list(t) for t in calib.NINE_TARGETS],
          "message": "Calibration ready. Send target control lines."})
    groups = []
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            cmd = msg.get("cmd")
            if cmd == "abort":
                emit({"type": "calibration", "phase": "aborted"})
                return 1
            if cmd == "finish":
                break
            if cmd != "target":
                continue
            tx, ty = float(msg.get("x", 0.5)), float(msg.get("y", 0.5))
            # Discard settle frames so the eyes have arrived at the dot.
            settle_end = time.monotonic() + settle_seconds
            while time.monotonic() < settle_end:
                _read_raw_sample(capture, landmarker)
            raws = []
            attempts = 0
            while len(raws) < samples_per_target and attempts < samples_per_target * 4:
                attempts += 1
                raw = _read_raw_sample(capture, landmarker)
                if raw is not None:
                    raws.append(raw)
            if not raws:
                emit({"type": "calibration", "phase": "target_skipped",
                      "target": [tx, ty], "message": "No face for this target."})
                continue
            groups.append(((tx, ty), raws))
            emit({"type": "calibration", "phase": "captured",
                  "target": [tx, ty], "samples": len(raws), "collected": len(groups)})
        if len(groups) < 3:
            emit({"type": "calibration", "phase": "failed",
                  "message": f"Need >=3 targets, got {len(groups)}."})
            return 1
        profile = calib.build_profile(groups)
        path = calib.save_profile(profile)
        emit({"type": "calibration", "phase": "saved", "path": path,
              "targets": profile["targets"], "samples": profile["samples"]})
        return 0
    finally:
        capture.release()
        landmarker.close()


def run(camera_index, preview):
    emit({"type": "status", "message": "Starting MediaPipe Iris gaze sidecar."})
    profile = calib.load_profile()
    smoother = calib.GazeSmoother()
    if profile is not None:
        emit({"type": "status", "message": "Loaded per-user gaze calibration profile.",
              "calibrated": True})
    else:
        emit({"type": "status", "message": "No calibration profile; using fallback mapping.",
              "calibrated": False})
    capture, landmarker = _open_landmarker(camera_index)
    if capture is None:
        return 1
    emit({"type": "status", "message": "Camera active. MediaPipe Iris is tracking locally."})

    last_emit = 0.0
    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                emit({"type": "error", "message": "Camera frame read failed."})
                return 1

            frame = cv2.flip(frame, 1)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            now = time.monotonic()
            result = landmarker.detect_for_video(mp_image, int(now * 1000))

            if not result.face_landmarks:
                if now - last_emit > 1.0:
                    emit({"type": "status", "message": "Camera active. No face detected."})
                    last_emit = now
                if preview:
                    cv2.imshow("eri gaze", frame)
                    if cv2.waitKey(1) & 0xFF == 27:
                        break
                continue

            landmarks = result.face_landmarks[0]
            raw = raw_gaze_from_landmarks(landmarks)
            if raw is None:
                emit({"type": "status", "message": "Face detected. Iris landmarks unavailable."})
                continue
            raw_x, raw_y = raw

            # Map raw iris ratios to the screen. With a per-user calibration
            # profile this uses the fitted ridge regressor; otherwise it falls
            # back to the legacy magic-gain geometry (never crashes).
            mapped_x, mapped_y = map_to_screen(raw_x, raw_y, profile)
            # One-euro smoothing stabilises frame-to-frame jitter for UI
            # targeting (cheap; tracks fast saccades but kills micro-tremor).
            screen_x, screen_y = smoother.smooth(mapped_x, mapped_y, now)
            confidence = clamp(0.72 - (abs(raw_x - 0.5) + abs(raw_y - 0.5)) * 0.18)

            if now - last_emit >= 0.08:
                emit(
                    {
                        "type": "gaze",
                        "target": "camera",
                        "label": "MediaPipe Iris",
                        "x": round(screen_x, 4),
                        "y": round(screen_y, 4),
                        "confidence": round(confidence, 3),
                    }
                )
                last_emit = now

            if preview:
                height, width = frame.shape[:2]
                point = (int(screen_x * width), int(screen_y * height))
                cv2.circle(frame, point, 16, (120, 190, 255), 3)
                cv2.line(frame, (point[0] - 20, point[1]), (point[0] + 20, point[1]),
                         (120, 190, 255), 1)
                cv2.line(frame, (point[0], point[1] - 20), (point[0], point[1] + 20),
                         (120, 190, 255), 1)
                cv2.putText(
                    frame,
                    f"eri gaze · raw ({raw_x:.2f}, {raw_y:.2f}) -> screen ({screen_x:.2f}, {screen_y:.2f}) conf {confidence:.2f}",
                    (18, 32),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    (120, 190, 255),
                    1,
                    cv2.LINE_AA,
                )
                for idx in (LEFT_EYE_INNER, LEFT_EYE_OUTER, LEFT_EYE_TOP, LEFT_EYE_BOTTOM,
                            RIGHT_EYE_INNER, RIGHT_EYE_OUTER, RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM):
                    point_idx = (int(landmarks[idx].x * width), int(landmarks[idx].y * height))
                    cv2.circle(frame, point_idx, 2, (60, 200, 90), -1)
                for iris_set in (LEFT_IRIS, RIGHT_IRIS):
                    for idx in iris_set:
                        point_iris = (int(landmarks[idx].x * width), int(landmarks[idx].y * height))
                        cv2.circle(frame, point_iris, 2, (255, 200, 80), -1)
                cv2.imshow("eri gaze", frame)
                if cv2.waitKey(1) & 0xFF == 27:
                    break
    finally:
        capture.release()
        landmarker.close()
        if preview:
            cv2.destroyAllWindows()

    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--calibrate", action="store_true",
                        help="9-point calibration; reads target control lines on stdin")
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--samples", type=int, default=20,
                        help="frames averaged per calibration target")
    args = parser.parse_args()

    if args.calibrate:
        return calibrate(args.camera, samples_per_target=args.samples)

    if not args.run:
        emit({"type": "status", "message": "Usage: script/eri_gaze_sidecar --run"})
        return 0

    return run(args.camera, args.preview)


if __name__ == "__main__":
    raise SystemExit(main())
