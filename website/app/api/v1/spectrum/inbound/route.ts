// POST /api/v1/spectrum/inbound — the Spectrum (Photon) webhook for eri.
//
// The eri Everywhere inbound surface. The SDK's `app.webhook()` verifies the
// HMAC signature itself (bad sig → 401) and hands us `(space, message)`. The SDK
// dispatches that handler FIRE-AND-FORGET, so on serverless we must keep the
// work alive past the response — `waitUntil` registers the reply work with
// Vercel so the function stays warm until eri has answered. The reply runs the
// SAME shared `processInbound` the Sendblue route does.
//
// We read the body ourselves and hand the SDK its RAW input form
// (`{ body, headers }` — a documented public shape) instead of the `Request`:
// it keeps the exact POSTed bytes the HMAC is computed over, and it lets us
// fingerprint a delivery we can't route instead of guessing after the fact.
//
// Heavily logged on purpose: each step emits a JSON line so the Vercel runtime
// log shows exactly where an inbound goes (received → handling → done / error).

import { waitUntil } from "@vercel/functions";
import { logEvent, processInbound } from "@/lib/messaging/inbound_runtime";
import {
  describeSpectrumError,
  getSpectrumWebhookApp,
  makeSpectrumTransport,
  spectrumMessageToInbound,
} from "@/lib/messaging/spectrum";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // allow the background reply work up to 5 min

export async function POST(request: Request): Promise<Response> {
  const body = new Uint8Array(await request.arrayBuffer());
  const headers: Record<string, string> = {};
  for (const [k, v] of request.headers) headers[k.toLowerCase()] = v;

  // Fingerprint every delivery. `firstByte` is the discriminator the SDK itself
  // routes on: 123 (`{`) is a native Spectrum envelope, anything else is a
  // protobuf "fusor" body — which we have no provider for and must not 500 on.
  logEvent("spectrum.rx", {
    bytes: body.length,
    firstByte: body.length ? body[0] : null,
    contentType: headers["content-type"] ?? null,
    signed: Boolean(headers["x-spectrum-signature"]),
  });

  let app;
  try {
    app = await getSpectrumWebhookApp();
  } catch (e) {
    // The real init error — auth (bad creds), project-not-found, or suspended —
    // so the 500's cause is greppable, not a generic "Internal server error".
    logEvent("spectrum.app_init_failed", describeSpectrumError(e));
    return new Response(JSON.stringify({ error: "app_init" }), { status: 500 });
  }

  let handlerCalled = false;
  let result;
  try {
    result = await app.webhook({ body, headers }, (space, message) => {
      handlerCalled = true;
      // Keep the reply work alive past the response (serverless). Fire it now,
      // during the request, so `waitUntil` registers it with the platform.
      waitUntil(
        (async () => {
          try {
            logEvent("spectrum.handling", { id: message.id, type: message.content?.type });
            const msg = spectrumMessageToInbound(space, message);
            const inboundWasVoice = message.content?.type === "voice";
            // Pass the sender's handle so a send can self-heal a dead Photon token by
            // re-resolving this conversation from a fresh app (see makeSpectrumTransport).
            const out = await processInbound(msg, makeSpectrumTransport(space, message.sender?.id), { inboundWasVoice });
            logEvent("spectrum.done", { id: message.id, status: out.status, branch: out.branch });
          } catch (e) {
            logEvent("spectrum.handler_error", { error: e instanceof Error ? e.message : String(e) });
          }
        })(),
      );
    });
  } catch (e) {
    // A delivery the SDK cannot classify at all — today: a protobuf "fusor" body,
    // which `webhook()` THROWS on when no fusor provider is registered. That throw
    // used to surface as a 500, which only makes Photon retry it forever. 400 is
    // the honest answer (this endpoint doesn't speak that body) and the
    // fingerprint above records what actually arrived.
    logEvent("spectrum.unroutable_delivery", { bytes: body.length, ...describeSpectrumError(e) });
    return new Response(JSON.stringify({ error: "unroutable" }), { status: 400 });
  }

  // A 200 that never reached our handler is a SILENT DROP — exactly the failure
  // that took eri down (the SDK ACKs and discards when it can't map the
  // envelope's platform id to a provider). Name it so it can never be quiet again.
  if (!handlerCalled && result.status === 200) {
    logEvent("spectrum.acked_without_delivery", {
      bytes: body.length,
      signed: Boolean(headers["x-spectrum-signature"]),
    });
  }

  logEvent("spectrum.responding", { handlerCalled, status: result.status });
  return new Response(result.body, { status: result.status, headers: result.headers });
}
