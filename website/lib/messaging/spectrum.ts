/**
 * Spectrum (Photon) adapter — "eri Everywhere" M1.
 *
 * The thin provider layer between Spectrum's SDK and eri's shared inbound
 * runtime. It (1) builds a memoized Spectrum instance from env credentials, (2)
 * maps an inbound Spectrum `Message` onto eri's existing `InboundMessage` so the
 * brain (`handleInbound`) is reused untouched, and (3) exposes an
 * `InboundTransport` (typing + reply) backed by `space.send()`.
 *
 * The SDK's `app.webhook()` verifies the HMAC signature itself (bad sig → 401)
 * and hands the route a fully-built `space` with `.send()` / `.react()` / mini-
 * app builders — so the route never re-implements crypto. Outbound is just
 * `space.send(chunk)`.
 */

import { Spectrum, typing, voice, type Message, type Space } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import type { InboundMessage } from "@/lib/imessage/webhook";
import type { InboundTransport } from "@/lib/messaging/inbound_runtime";
import { synthesizeSpeech, textForSpeech } from "@/lib/messaging/voice";

/** Read the first non-empty of several env names (so we accept both our
 *  `PHOTON_*` naming and Photon's default `.env` naming — `PROJECT_ID` etc.). */
function envAny(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  throw new Error(`none of [${names.join(", ")}] is configured (Spectrum adapter)`);
}

/** Build the Spectrum instance once. `webhookSecret` (optional) lets the SDK
 *  verify inbound webhook deliveries; it's unused by the streaming worker, which
 *  consumes `app.messages` instead. Both the webhook route and the worker share
 *  this one factory. */
function createApp() {
  return Spectrum({
    projectId: envAny("PHOTON_PROJECT_ID", "PROJECT_ID"),
    projectSecret: envAny("PHOTON_PROJECT_SECRET", "PROJECT_SECRET"),
    webhookSecret: process.env.PHOTON_WEBHOOK_SECRET ?? process.env.WEBHOOK_SECRET,
    providers: [imessage.config()],
  });
}

let appPromise: ReturnType<typeof createApp> | null = null;

/** The memoized Spectrum app (reused across warm invocations). */
export function getSpectrumApp(): ReturnType<typeof createApp> {
  if (!appPromise) appPromise = createApp();
  return appPromise;
}

/** Map an inbound Spectrum message onto eri's existing InboundMessage shape so
 *  `handleInbound` is reused as-is. Non-text content (a shared link) maps to its
 *  URL; anything else yields empty text (the brain replies conversationally). */
export function spectrumMessageToInbound(space: Space, message: Message): InboundMessage {
  const content = message.content;
  let text = "";
  if (content.type === "text") {
    text = content.text;
  } else if (content.type === "richlink") {
    text = content.url;
  }
  return {
    fromNumber: message.sender?.id ?? space.id,
    content: text,
    messageHandle: message.id,
    isOutbound: false,
    service: "iMessage",
  };
}

/** A reply/typing transport bound to one Spectrum conversation. */
export function makeSpectrumTransport(space: Space): InboundTransport {
  return {
    sendTyping: async () => {
      try {
        await space.send(typing());
      } catch {
        // best-effort — a missing typing bubble must never block the reply.
      }
    },
    sendReply: async (chunks, ctx) => {
      // Voice reply (per the user's setting): synthesize the whole reply once and
      // send it as one voice note. Any failure falls through to a text reply, so
      // the message is never lost to a flaky TTS call.
      if (ctx.speak) {
        const key = process.env.ELEVENLABS_API_KEY;
        const spoken = textForSpeech(chunks.join(" "));
        if (key && spoken) {
          try {
            const audio = await synthesizeSpeech(spoken, {
              apiKey: key,
              voiceId: process.env.ELEVENLABS_VOICE_ID,
            });
            await space.send(voice(audio));
            return true;
          } catch {
            // fall through to text
          }
        }
      }
      for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        try {
          await space.send(chunk);
        } catch {
          return false;
        }
      }
      return true;
    },
  };
}
