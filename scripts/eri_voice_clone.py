#!/usr/bin/env python3
"""ElevenLabs Instant Voice Clone wizard for eri.

Captures ~30 seconds of microphone audio, uploads it to ElevenLabs as a
voice clone sample, and persists the new ``voice_id`` so the TTS sidecar
can speak in the user's voice.

Run via the wrapper:

    script/eri_voice_clone

Outputs JSON lines on stdout so the panel can stream status to the user:

    {"type": "status",   "message": "Recording in 3..."}
    {"type": "level",    "rms": 0.04}                       # during capture
    {"type": "progress", "elapsed": 12, "total": 30}        # during capture
    {"type": "saved",    "path": "~/.eri/voice-samples/...wav"}
    {"type": "uploaded", "voice_id": "abc...", "name": "eri user 1715..."}
    {"type": "done",     "voice_id": "abc..."}
    {"type": "error",    "message": "..."}
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent

try:
    from dotenv import load_dotenv  # type: ignore

    load_dotenv(ROOT_DIR / ".env")
except Exception:
    pass


SAMPLE_RATE = 44100
CHANNELS = 1
SAMPLE_WIDTH_BYTES = 2  # 16-bit PCM
DEFAULT_DURATION_SECS = 30
COUNTDOWN_SECS = 3
PROMPT_SENTENCE = (
    "The quick brown fox jumps over the lazy dog. "
    "eri builds apps as fast as I can speak."
)


def emit(event: dict[str, Any]) -> None:
    print(json.dumps(event, separators=(",", ":")), flush=True)


@dataclass(frozen=True)
class RecordingArtifact:
    path: Path
    duration_secs: float


def eri_home() -> Path:
    home = os.environ.get("HOME")
    if not home:
        raise RuntimeError("HOME is not set; cannot resolve ~/.eri")
    return Path(home) / ".eri"


def samples_dir() -> Path:
    directory = eri_home() / "voice-samples"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def cloned_voice_path() -> Path:
    return eri_home() / "cloned_voice_id"


def dotenv_path() -> Path:
    return ROOT_DIR / ".env"


def record_wav(duration_secs: int) -> RecordingArtifact:
    try:
        import numpy as np  # type: ignore
        import sounddevice as sd  # type: ignore
    except Exception as error:
        raise RuntimeError(
            "sounddevice/numpy not installed in .venv-tts. "
            f"Run: script/eri_tts_setup. ({error})"
        ) from error

    emit(
        {
            "type": "status",
            "message": (
                "Read this aloud while recording: " + PROMPT_SENTENCE
            ),
        }
    )
    for remaining in range(COUNTDOWN_SECS, 0, -1):
        emit({"type": "status", "message": f"Recording in {remaining}..."})
        time.sleep(1.0)
    emit({"type": "status", "message": "Recording. Speak now."})

    total_frames = SAMPLE_RATE * duration_secs
    started = time.monotonic()
    last_progress = -1

    chunks: list[Any] = []

    def on_audio(indata, frames, _time_info, _status) -> None:  # type: ignore[no-untyped-def]
        chunks.append(indata.copy())
        rms = float(np.sqrt(np.mean(np.square(indata.astype(np.float32) / 32768.0))))
        emit({"type": "level", "rms": round(rms, 4)})

    with sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype="int16",
        callback=on_audio,
    ):
        while True:
            elapsed = time.monotonic() - started
            elapsed_int = int(elapsed)
            if elapsed_int != last_progress:
                emit(
                    {
                        "type": "progress",
                        "elapsed": elapsed_int,
                        "total": duration_secs,
                    }
                )
                last_progress = elapsed_int
            if elapsed >= duration_secs:
                break
            time.sleep(0.1)

    if not chunks:
        raise RuntimeError("No audio captured — is your microphone connected?")

    audio = np.concatenate(chunks, axis=0)
    if audio.shape[0] > total_frames:
        audio = audio[:total_frames]

    timestamp = int(time.time())
    wav_path = samples_dir() / f"{timestamp}.wav"
    with wave.open(str(wav_path), "wb") as wav_file:
        wav_file.setnchannels(CHANNELS)
        wav_file.setsampwidth(SAMPLE_WIDTH_BYTES)
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(audio.tobytes())

    duration_actual = audio.shape[0] / float(SAMPLE_RATE)
    emit({"type": "saved", "path": str(wav_path), "seconds": round(duration_actual, 2)})
    return RecordingArtifact(path=wav_path, duration_secs=duration_actual)


def upload_clone(artifact: RecordingArtifact) -> tuple[str, str]:
    api_key = (
        os.environ.get("ELEVENLABS_API_KEY")
        or os.environ.get("ELEVEN_API_KEY")
    )
    if not api_key:
        raise RuntimeError(
            "ELEVENLABS_API_KEY is not set. Add it to .env or export it before "
            "running script/eri_voice_clone."
        )
    try:
        from elevenlabs.client import ElevenLabs  # type: ignore
    except Exception as error:
        raise RuntimeError(
            "elevenlabs SDK is not installed in .venv-tts. "
            f"Run: script/eri_tts_setup. ({error})"
        ) from error

    client = ElevenLabs(api_key=api_key)
    voice_name = f"eri user {int(time.time())}"
    emit({"type": "status", "message": f"Uploading clone as '{voice_name}'..."})

    try:
        with open(artifact.path, "rb") as wav_file:
            result = client.voices.add(
                name=voice_name,
                files=[wav_file],
                description=(
                    "Cloned from a 30-second sample inside eri. Used by the "
                    "TTS sidecar so eri can speak in the user's own voice."
                ),
            )
    except Exception as error:
        message = str(error)
        # ElevenLabs SDK exceptions surface .status_code on ApiError; fall back
        # to string-matching when they do not.
        status_code = getattr(error, "status_code", None)
        if status_code == 402 or "402" in message or "subscription" in message.lower():
            raise RuntimeError(
                "Voice cloning requires ElevenLabs Starter ($5/mo) or higher. "
                "Upgrade at https://elevenlabs.io/app/subscription"
            ) from error
        raise RuntimeError(f"ElevenLabs voice clone failed: {error}") from error

    voice_id = getattr(result, "voice_id", None) or getattr(result, "id", None)
    if not voice_id:
        raise RuntimeError("ElevenLabs returned no voice_id from voices.add().")
    emit(
        {
            "type": "uploaded",
            "voice_id": voice_id,
            "name": voice_name,
        }
    )
    return voice_id, voice_name


def persist_voice_id(voice_id: str) -> None:
    target = cloned_voice_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(voice_id + "\n", encoding="utf-8")

    # Append (never overwrite) the .env file. We rewrite any existing
    # ERI_TTS_VOICE line in place so we don't end up with duplicates that
    # silently mask each other.
    env_path = dotenv_path()
    new_line = f"ERI_TTS_VOICE={voice_id}"
    existing_lines: list[str] = []
    if env_path.exists():
        existing_lines = env_path.read_text(encoding="utf-8").splitlines()
    replaced = False
    out_lines: list[str] = []
    for line in existing_lines:
        if line.strip().startswith("ERI_TTS_VOICE="):
            out_lines.append(new_line)
            replaced = True
        else:
            out_lines.append(line)
    if not replaced:
        if out_lines and out_lines[-1].strip():
            out_lines.append("")
        out_lines.append(new_line)
    env_path.write_text("\n".join(out_lines).rstrip() + "\n", encoding="utf-8")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="eri voice clone wizard")
    parser.add_argument(
        "--duration",
        type=int,
        default=DEFAULT_DURATION_SECS,
        help="Seconds of audio to capture (default: 30).",
    )
    args = parser.parse_args(argv)

    try:
        artifact = record_wav(max(5, int(args.duration)))
        voice_id, voice_name = upload_clone(artifact)
        persist_voice_id(voice_id)
        emit(
            {
                "type": "status",
                "message": (
                    f"Your cloned voice ID is {voice_id}. "
                    f"Set ERI_TTS_VOICE={voice_id} to use it."
                ),
            }
        )
        emit({"type": "done", "voice_id": voice_id, "name": voice_name})
        return 0
    except KeyboardInterrupt:
        emit({"type": "error", "message": "Recording cancelled."})
        return 130
    except RuntimeError as error:
        emit({"type": "error", "message": str(error)})
        return 1
    except Exception as error:  # pragma: no cover - defensive
        emit(
            {
                "type": "error",
                "message": f"Unexpected failure: {error}",
                "detail": traceback.format_exc(),
            }
        )
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
