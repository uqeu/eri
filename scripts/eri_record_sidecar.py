#!/usr/bin/env python3
"""Demo-recording sidecar for eri (macOS-only, v1).

Wraps the system `ffmpeg` binary so the Rust panel can capture a single MP4
of the current screen + microphone + (optionally) eri's audio output for the
YC pitch demo loop. The sidecar holds the ffmpeg child for as long as the
parent eri process leaves it running; on SIGTERM/SIGINT we forward a graceful
`q` keystroke to ffmpeg so the MP4 trailer is written and the file is
playable.

Invocation contracts (the only one the panel uses today is `--start`):

    script/eri_record_sidecar --start --output /path/to/clip.mp4
    script/eri_record_sidecar --check

Emits one JSON line per event on stdout so the Rust panel can drain it the
same way it does for the other sidecars (eri_tts_sidecar, eri_brain_sidecar):

    {"type":"status","message":"recording started","output":"/.../clip.mp4"}
    {"type":"error","message":"ffmpeg not installed — run: brew install ffmpeg"}
    {"type":"stopped","output":"/.../clip.mp4","exit_code":0}

Device selection (macOS AVFoundation):
    Video device id (screen): env `ERI_RECORD_VIDEO_DEVICE`  (default: "1")
    Audio device id (mic):    env `ERI_RECORD_AUDIO_DEVICE`  (default: "0")

Combined avfoundation input string is `"<video>:<audio>"`. To find your
device indices, run:

    ffmpeg -f avfoundation -list_devices true -i ""

ffmpeg flag set targets pitch-quality output on Apple Silicon:
    - h264_videotoolbox encoder (hardware accelerated, no CPU melt)
    - 6 Mbps video bitrate, 30 fps capture
    - AAC 192 kbps audio
    - yuv420p pixel format for QuickTime / Keynote compatibility

This script is intentionally stdlib-only (subprocess + signal + shutil) so it
can run from the existing `.venv-tts` venv without adding wheels. It will
also run from a bare system python3 — the wrapper bash script picks the
interpreter.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


DEFAULT_VIDEO_DEVICE = os.environ.get("ERI_RECORD_VIDEO_DEVICE", "1")
DEFAULT_AUDIO_DEVICE = os.environ.get("ERI_RECORD_AUDIO_DEVICE", "0")
DEFAULT_FRAMERATE = os.environ.get("ERI_RECORD_FRAMERATE", "30")
DEFAULT_VIDEO_BITRATE = os.environ.get("ERI_RECORD_VIDEO_BITRATE", "6M")
DEFAULT_AUDIO_BITRATE = os.environ.get("ERI_RECORD_AUDIO_BITRATE", "192k")


def emit(event: dict[str, Any]) -> None:
    """Write a single JSON event line to stdout and flush immediately."""
    sys.stdout.write(json.dumps(event, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def find_ffmpeg() -> str | None:
    return shutil.which("ffmpeg")


def assert_macos() -> bool:
    if sys.platform != "darwin":
        emit(
            {
                "type": "error",
                "message": (
                    "eri_record_sidecar is macOS-only (v1). "
                    "Screen + mic + system-audio capture uses AVFoundation."
                ),
            }
        )
        return False
    return True


def check() -> int:
    """Report ffmpeg availability without starting a recording.

    Used by the panel at boot to surface a precise install hint instead of
    failing only when the user actually says "start recording".
    """
    if not assert_macos():
        return 1
    ffmpeg = find_ffmpeg()
    if ffmpeg is None:
        emit(
            {
                "type": "error",
                "message": "ffmpeg not installed — run: brew install ffmpeg",
            }
        )
        return 1
    emit({"type": "status", "message": "ffmpeg available", "path": ffmpeg})
    return 0


def build_ffmpeg_command(ffmpeg: str, output: Path) -> list[str]:
    avf_input = f"{DEFAULT_VIDEO_DEVICE}:{DEFAULT_AUDIO_DEVICE}"
    return [
        ffmpeg,
        "-y",  # overwrite — the panel always passes a fresh timestamped path
        "-hide_banner",
        "-loglevel",
        "warning",
        "-f",
        "avfoundation",
        "-framerate",
        DEFAULT_FRAMERATE,
        "-capture_cursor",
        "1",
        "-i",
        avf_input,
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "h264_videotoolbox",
        "-b:v",
        DEFAULT_VIDEO_BITRATE,
        "-c:a",
        "aac",
        "-b:a",
        DEFAULT_AUDIO_BITRATE,
        str(output),
    ]


def start(output: Path) -> int:
    if not assert_macos():
        return 1
    ffmpeg = find_ffmpeg()
    if ffmpeg is None:
        emit(
            {
                "type": "error",
                "message": "ffmpeg not installed — run: brew install ffmpeg",
            }
        )
        return 127

    try:
        output.parent.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        emit(
            {
                "type": "error",
                "message": f"could not create output directory {output.parent}: {error}",
            }
        )
        return 1

    cmd = build_ffmpeg_command(ffmpeg, output)
    emit(
        {
            "type": "status",
            "message": "recording started",
            "output": str(output),
            "video_device": DEFAULT_VIDEO_DEVICE,
            "audio_device": DEFAULT_AUDIO_DEVICE,
        }
    )

    try:
        process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
    except OSError as error:
        emit({"type": "error", "message": f"could not spawn ffmpeg: {error}"})
        return 1

    def graceful_stop(_signum: int, _frame: Any) -> None:
        # ffmpeg flushes and finalizes the MP4 trailer when it receives a "q"
        # on stdin. SIGTERM alone produces a truncated, unplayable file —
        # we send "q" first and only fall back to SIGTERM if ffmpeg hangs.
        if process.poll() is not None:
            return
        try:
            if process.stdin is not None:
                process.stdin.write(b"q")
                process.stdin.flush()
        except (BrokenPipeError, OSError):
            pass
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            if process.poll() is not None:
                return
            time.sleep(0.1)
        # ffmpeg didn't honor "q" within 5s — escalate.
        try:
            process.terminate()
        except OSError:
            pass

    signal.signal(signal.SIGTERM, graceful_stop)
    signal.signal(signal.SIGINT, graceful_stop)

    try:
        exit_code = process.wait()
    except KeyboardInterrupt:
        graceful_stop(signal.SIGINT, None)
        exit_code = process.wait()

    stderr_tail = b""
    if process.stderr is not None:
        try:
            stderr_tail = process.stderr.read() or b""
        except OSError:
            stderr_tail = b""

    if exit_code != 0 and not output.exists():
        emit(
            {
                "type": "error",
                "message": f"ffmpeg exited {exit_code} without producing output",
                "stderr": stderr_tail.decode("utf-8", errors="replace")[-500:],
                "output": str(output),
            }
        )
        return exit_code

    emit(
        {
            "type": "stopped",
            "output": str(output),
            "exit_code": exit_code,
        }
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", action="store_true", help="begin recording")
    parser.add_argument("--check", action="store_true", help="check ffmpeg availability")
    parser.add_argument("--output", type=Path, help="MP4 output path (with --start)")
    args = parser.parse_args()

    if args.check:
        return check()
    if args.start:
        if args.output is None:
            emit({"type": "error", "message": "--start requires --output <path>"})
            return 2
        return start(args.output)

    emit(
        {
            "type": "status",
            "message": "Usage: script/eri_record_sidecar --start --output <path>",
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
