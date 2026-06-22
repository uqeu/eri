/**
 * eri voice-note replies via ElevenLabs ("eri Everywhere" M1).
 *
 * eri replies in text by default (reliable); a voice note is a per-user setting
 * because TTS can be flaky. `shouldSpeak` is the pure decision (never / auto /
 * always); `synthesizeSpeech` renders the reply to mp3 via ElevenLabs; the
 * Spectrum transport sends it as a `voice()` attachment. Incoming voice notes
 * are transcribed separately (Whisper) — this module is the OUTBOUND half.
 *
 * Everything here is pure (the network call takes an injected `fetch`) so it's
 * unit-tested without a key or a live call.
 */

/** Per-user voice-reply mode. "auto" = mirror the user (speak only when they
 *  sent a voice note). */
export type VoiceMode = "never" | "auto" | "always";

/** Whether eri should reply with a voice note this turn. Pure + tested. */
export function shouldSpeak(mode: VoiceMode | undefined, inboundWasVoice: boolean): boolean {
  switch (mode) {
    case "always":
      return true;
    case "auto":
      return inboundWasVoice;
    default:
      return false; // "never" or unset → text only
  }
}

const ELEVEN_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
/** A calm default eri voice; override per-deploy with ELEVENLABS_VOICE_ID. */
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
/** Cheapest/fastest ElevenLabs model — voice notes should be snappy + low-cost. */
const DEFAULT_MODEL = "eleven_flash_v2_5";
/** Keep voice notes short: spoken essays are bad UX and cost more. */
export const MAX_TTS_CHARS = 800;

/**
 * Prepare reply text for speech: drop code blocks and markdown punctuation (they
 * read terribly aloud), turn bare URLs into "a link", collapse whitespace, and
 * cap the length on a word boundary. Pure + tested.
 */
export function textForSpeech(text: string, max: number = MAX_TTS_CHARS): string {
  const clean = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\bhttps?:\/\/\S+/g, "a link")
    .replace(/[*_#>~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

export interface SynthDeps {
  apiKey: string;
  voiceId?: string;
  modelId?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Render `text` to mp3 audio bytes via ElevenLabs. Throws on a non-OK response or
 * empty audio so the caller can fall back to a text reply (a voice note must
 * never silently swallow the message).
 */
export async function synthesizeSpeech(text: string, deps: SynthDeps): Promise<Buffer> {
  const doFetch = deps.fetchImpl ?? fetch;
  const voiceId = deps.voiceId || DEFAULT_VOICE_ID;
  const res = await doFetch(`${ELEVEN_TTS_URL}/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": deps.apiKey,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: deps.modelId || DEFAULT_MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) throw new Error(`elevenlabs tts ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("elevenlabs returned empty audio");
  return buf;
}
