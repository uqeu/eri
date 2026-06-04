"use strict";
// Thin client for the local eri TTS sidecar (scripts/eri_tts_sidecar.py).
//
// The sidecar listens on 127.0.0.1:8766 and accepts `POST /speak` with
// `{ text, voice? }`. When `voice` is omitted it uses its own default voice
// (ERI_TTS_VOICE or the hardcoded eri_prod_voice id), so callers don't have to
// know the voice binding. Best-effort: if the sidecar isn't running, speaking
// is a silent no-op -- never throws into the caller.
Object.defineProperty(exports, "__esModule", { value: true });
exports.speak = speak;
const TTS_BASE = process.env.ERI_TTS_URL ?? "http://127.0.0.1:8766";
const SPEAK_TIMEOUT_MS = 2000;
/**
 * Ask the TTS sidecar to speak `text`. Returns true if the sidecar accepted it.
 * `voice` is optional (sidecar default = eri_prod_voice).
 */
async function speak(text, voice) {
    const trimmed = text.trim();
    if (trimmed.length === 0)
        return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SPEAK_TIMEOUT_MS);
    try {
        const body = { text: trimmed };
        if (voice && voice.trim().length > 0) {
            body.voice = voice.trim();
        }
        const res = await fetch(`${TTS_BASE}/speak`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        // The sidecar returns 202 Accepted on success.
        return res.ok || res.status === 202;
    }
    catch {
        // Sidecar down / not reachable -> silently skip. Voice is opportunistic.
        return false;
    }
    finally {
        clearTimeout(timer);
    }
}
//# sourceMappingURL=ttsClient.js.map