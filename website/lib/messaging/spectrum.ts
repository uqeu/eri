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
import { logEvent, type InboundTransport } from "@/lib/messaging/inbound_runtime";
import { withSendRetry } from "@/lib/messaging/send_retry";
import { synthesizeSpeech, textForSpeech } from "@/lib/messaging/voice";

/**
 * Pull as much real detail as possible out of a thrown Photon/SDK error so a
 * previously-swallowed failure becomes a greppable structured log line. The
 * Spectrum iMessage transport authenticates via a Photon token exchange both at
 * init and before every send, so a send failure is usually that exchange — and
 * its status/body is what distinguishes bad creds from a plan/line problem.
 */
export function describeSpectrumError(e: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { message: e instanceof Error ? e.message : String(e) };
  if (e instanceof Error) {
    out.name = e.name;
    const r = e as unknown as Record<string, unknown>;
    for (const k of ["status", "statusCode", "code", "cause"]) {
      const v = r[k];
      if (v !== undefined) out[k] = v instanceof Error ? v.message : v;
    }
    const resp = r.response;
    if (resp && typeof resp === "object") {
      const rr = resp as Record<string, unknown>;
      if (rr.status !== undefined) out.responseStatus = rr.status;
      const body = rr.body ?? rr.data;
      if (typeof body === "string") out.responseBody = body.slice(0, 300);
    }
  }
  return out;
}

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

/** The memoized Spectrum app (reused across warm invocations). A TRANSIENT init
 *  failure (e.g. the Photon token exchange 500-ing) must NOT be cached — otherwise
 *  one bad cold start bricks every subsequent warm request until the lambda
 *  recycles. If init is async and rejects, log the real cause and clear the cache
 *  so the next request retries fresh. */
export function getSpectrumApp(): ReturnType<typeof createApp> {
  if (!appPromise) {
    const created = createApp();
    appPromise = created;
    const thenable = created as unknown as { then?: unknown; catch?: (f: (e: unknown) => void) => void };
    if (typeof thenable.then === "function" && typeof thenable.catch === "function") {
      thenable.catch((e: unknown) => {
        logEvent("spectrum.app_init_rejected", describeSpectrumError(e));
        if (appPromise === created) appPromise = null;
      });
    }
  }
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
      } catch (e) {
        // best-effort — a missing typing bubble must never block the reply — but
        // surface the cause: it's the same Photon auth path the real send uses, so
        // a typing failure is an early warning of a send failure.
        logEvent("spectrum.typing_failed", { spaceId: space.id, ...describeSpectrumError(e) });
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
          } catch (e) {
            logEvent("spectrum.voice_send_failed", { spaceId: space.id, ...describeSpectrumError(e) });
            // fall through to text
          }
        }
      }
      for (const chunk of chunks) {
        if (!chunk.trim()) continue;
        try {
          await withSendRetry(() => space.send(chunk));
        } catch (e) {
          // The REAL Photon outbound error — previously swallowed. This line names
          // the cause: bad creds (401/invalid_client), plan/quota (402/403), or a
          // line-not-provisioned-for-outbound. It's the whole point of this fix.
          logEvent("spectrum.send_failed", { spaceId: space.id, ...describeSpectrumError(e) });
          return false;
        }
      }
      return true;
    },
  };
}
