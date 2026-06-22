import { strict as assert } from "node:assert";
import { shouldSpeak, textForSpeech, synthesizeSpeech, MAX_TTS_CHARS } from "../messaging/voice";

async function run() {
  // shouldSpeak — the per-user voice decision.
  {
    assert.equal(shouldSpeak("never", true), false);
    assert.equal(shouldSpeak("never", false), false);
    assert.equal(shouldSpeak(undefined, true), false, "unset → text only");
    assert.equal(shouldSpeak("always", false), true);
    assert.equal(shouldSpeak("auto", true), true, "auto mirrors: voice in → voice out");
    assert.equal(shouldSpeak("auto", false), false, "auto: text in → text out");
  }

  // textForSpeech — strips code/markdown/URLs, collapses whitespace, caps length.
  {
    assert.equal(textForSpeech("**hey** _there_"), "hey there");
    assert.equal(textForSpeech("run `npm test` ok"), "run npm test ok");
    assert.equal(textForSpeech("see https://tryeri.ca now"), "see a link now");
    assert.equal(textForSpeech("```\ncode\n```done"), "done");
    const long = "word ".repeat(400); // 2000 chars
    const out = textForSpeech(long);
    assert.ok(out.length <= MAX_TTS_CHARS + 1, "capped near MAX_TTS_CHARS");
    assert.ok(out.endsWith("…"), "ellipsis on truncation");
  }

  // synthesizeSpeech — posts to ElevenLabs and returns the audio buffer.
  {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeAudio = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => fakeAudio.buffer,
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const buf = await synthesizeSpeech("hello", { apiKey: "xi_test", voiceId: "v123", fetchImpl });
    assert.ok(Buffer.isBuffer(buf));
    assert.equal(buf.length, 4);
    assert.equal(calls.length, 1, "fetch called once");
    const call = calls[0];
    assert.ok(call.url.endsWith("/text-to-speech/v123"), "correct voice id in URL");
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers["xi-api-key"], "xi_test");
    assert.equal(headers["accept"], "audio/mpeg");
    const body = JSON.parse(call.init.body as string);
    assert.equal(body.text, "hello");
    assert.ok(typeof body.model_id === "string");
  }

  // Non-OK response throws (caller falls back to text).
  {
    const fetchImpl = (async () => ({ ok: false, status: 429, arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response) as unknown as typeof fetch;
    await assert.rejects(() => synthesizeSpeech("x", { apiKey: "k", fetchImpl }), /elevenlabs tts 429/);
  }

  // Empty audio throws.
  {
    const fetchImpl = (async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response) as unknown as typeof fetch;
    await assert.rejects(() => synthesizeSpeech("x", { apiKey: "k", fetchImpl }), /empty audio/);
  }

  // eslint-disable-next-line no-console
  console.log("voice.test.ts: all assertions passed");
}

run();
