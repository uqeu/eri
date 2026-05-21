"""Dump every voice in the user's ElevenLabs library with id, name, category.

Run:
    .venv-tts/bin/python script/list_voices.py
"""

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

from elevenlabs.client import ElevenLabs

client = ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])
voices = client.voices.get_all().voices
for v in voices:
    print(f"{v.voice_id}  {v.name}  ({getattr(v, 'category', '')})")
