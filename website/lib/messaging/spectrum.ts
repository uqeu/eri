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
import { isTokenExpired, withSendRetry } from "@/lib/messaging/send_retry";
import { aliasWirePlatformKeys, readPlatformRegistry } from "@/lib/messaging/spectrum_platforms";
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

/** Drop the memoized app so the next getSpectrumApp() builds a FRESH connection +
 *  token. Used by the always-on streaming worker to fully re-establish on a
 *  reconnect (a stale app's stream won't resume). */
export function resetSpectrumApp(): void {
  const old = appPromise;
  appPromise = null;
  // DISPOSE the old app's message stream so its underlying gRPC client — and the
  // process (SIGTERM) listener the SDK registers per connection — is torn down.
  // Otherwise every reconnect / token-refresh leaks one, tripping
  // MaxListenersExceededWarning over a long-lived worker. Best-effort + async.
  if (old) {
    void Promise.resolve(old)
      .then((app) => (app as { messages?: { close?: () => Promise<void> } })?.messages?.close?.())
      .catch(() => {});
  }
}

/**
 * The memoized app, prepared for `app.webhook()`.
 *
 * `app.webhook()` routes by the platform id in the delivery envelope
 * (`"imessage"`) while the SDK's registry is keyed by the provider definition
 * name (`"iMessage"`), so without this the SDK ACKs every inbound message with
 * 200 and never calls our handler — see `spectrum_platforms.ts` for the full
 * account. Aliasing the wire id onto the SAME runtime state restores routing.
 *
 * Deliberately NOT applied inside `getSpectrumApp()`: `app.messages` and
 * `app.stop()` ITERATE that registry, so a duplicate entry would double-
 * subscribe the worker's stream and double-destroy the client on shutdown. Only
 * the webhook route — which touches neither — opts in.
 *
 * Re-applied on every call because `resetSpectrumApp()` (the token self-heal)
 * can swap the instance underneath us; the alias is idempotent.
 */
export async function getSpectrumWebhookApp(): Promise<Awaited<ReturnType<typeof createApp>>> {
  const app = await getSpectrumApp();
  const added = aliasWirePlatformKeys(readPlatformRegistry(app));
  if (added === null) logEvent("spectrum.platform_alias_unavailable", {});
  else for (const alias of added) logEvent("spectrum.platform_alias", { ...alias });
  return app;
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

/**
 * Send an eri-INITIATED message over the business line (a proactive nudge). There
 * is no inbound space, so resolve/create a 1:1 space from the user's handle via
 * the iMessage provider — `create` works for an engaged user (resolves their
 * existing conversation) AND cold (starts one, subject to the line's cold-outreach
 * tier limits). Returns true only if every chunk landed; never throws, and logs
 * the real Photon error so a failure is diagnosable (not swallowed like Sendblue).
 */
export async function sendProactiveMessage(to: string, chunks: string[]): Promise<boolean> {
  const clean = chunks.filter((c) => c.trim());
  let sent = 0; // resume index — survives the token-refresh retry so nothing double-sends
  const run = async () => {
    const space = await imessage(await getSpectrumApp()).space.create(to);
    for (; sent < clean.length; sent++) await withSendRetry(() => space.send(clean[sent]));
  };
  try {
    await run();
    return true;
  } catch (e) {
    // Self-heal a DEAD Photon token (expired, reused across a warm Fluid instance):
    // drop the memoized app so the next getSpectrumApp() re-exchanges a fresh token,
    // rebuild the space, and resume from the un-sent chunk. So eri never goes silent.
    if (isTokenExpired(e)) {
      try {
        logEvent("spectrum.token_expired_refresh", { where: "proactive", to, ...describeSpectrumError(e) });
        resetSpectrumApp();
        await run();
        return true;
      } catch (e2) {
        logEvent("proactive.spectrum_send_failed", { to, retried: true, ...describeSpectrumError(e2) });
        return false;
      }
    }
    logEvent("proactive.spectrum_send_failed", { to, ...describeSpectrumError(e) });
    return false;
  }
}

/**
 * A reply/typing transport bound to one Spectrum conversation. `replyHandle` (the
 * sender's handle, from the inbound message) lets a send SELF-HEAL a dead Photon
 * token: on tokenExpired/UNAUTHENTICATED we drop the memoized app (fresh token
 * next), re-resolve the conversation from a fresh app, and retry — so eri never
 * goes silent behind an expired token reused across a warm Fluid instance.
 */
export function makeSpectrumTransport(space: Space, replyHandle?: string): InboundTransport {
  /** Re-resolve this conversation from a FRESH app (after resetSpectrumApp). */
  const freshSpace = async (): Promise<Space> => imessage(await getSpectrumApp()).space.create(replyHandle as string);

  return {
    sendTyping: async () => {
      try {
        await space.send(typing());
      } catch (e) {
        // A typing failure is the SAME Photon auth path as the real send, so a
        // tokenExpired here is the early warning: reset now so the reply that follows
        // gets a fresh token (and best-effort re-send the indicator). Never blocks.
        if (isTokenExpired(e) && replyHandle) {
          logEvent("spectrum.token_expired_refresh", { where: "typing", spaceId: space.id, ...describeSpectrumError(e) });
          resetSpectrumApp();
          try {
            await (await freshSpace()).send(typing());
          } catch {
            /* the reply path will heal; a missing typing bubble is harmless */
          }
          return;
        }
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
      const clean = chunks.filter((c) => c.trim());
      let sent = 0; // resume index — survives the token-refresh retry so nothing double-sends
      const run = async (sp: Space) => {
        for (; sent < clean.length; sent++) await withSendRetry(() => sp.send(clean[sent]));
      };
      try {
        await run(space);
        return true;
      } catch (e) {
        // Self-heal a dead Photon token: reset the memoized app (fresh token next),
        // re-resolve the conversation, resume from the un-sent chunk. So eri never
        // goes silent behind an expired token.
        if (isTokenExpired(e) && replyHandle) {
          try {
            logEvent("spectrum.token_expired_refresh", { where: "reply", spaceId: space.id, ...describeSpectrumError(e) });
            resetSpectrumApp();
            await run(await freshSpace());
            return true;
          } catch (e2) {
            logEvent("spectrum.send_failed", { spaceId: space.id, retried: true, ...describeSpectrumError(e2) });
            return false;
          }
        }
        // The REAL Photon outbound error — names the cause: bad creds, plan/quota,
        // or a line not provisioned for outbound.
        logEvent("spectrum.send_failed", { spaceId: space.id, ...describeSpectrumError(e) });
        return false;
      }
    },
  };
}
