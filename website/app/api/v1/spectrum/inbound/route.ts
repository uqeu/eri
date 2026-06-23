// POST /api/v1/spectrum/inbound — the Spectrum (Photon) webhook for eri.
//
// The eri Everywhere inbound surface. The SDK's `app.webhook()` verifies the
// HMAC signature itself (bad sig → 401) and hands us `(space, message)`. The SDK
// dispatches that handler FIRE-AND-FORGET, so on serverless we must keep the
// work alive past the response — `waitUntil` registers the reply work with
// Vercel so the function stays warm until eri has answered. The reply runs the
// SAME shared `processInbound` the Sendblue route does.
//
// Heavily logged on purpose: each step emits a JSON line so the Vercel runtime
// log shows exactly where an inbound goes (received → handling → done / error).

import { waitUntil } from "@vercel/functions";
import { logEvent, processInbound } from "@/lib/messaging/inbound_runtime";
import { getSpectrumApp, makeSpectrumTransport, spectrumMessageToInbound } from "@/lib/messaging/spectrum";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // allow the background reply work up to 5 min

export async function POST(request: Request): Promise<Response> {
  logEvent("spectrum.rx", {});

  let app;
  try {
    app = await getSpectrumApp();
  } catch (e) {
    logEvent("spectrum.app_init_failed", { error: e instanceof Error ? e.message : String(e) });
    return new Response(JSON.stringify({ error: "app_init" }), { status: 500 });
  }

  let handlerCalled = false;
  const response = await app.webhook(request, (space, message) => {
    handlerCalled = true;
    // Keep the reply work alive past the response (serverless). Fire it now,
    // during the request, so `waitUntil` registers it with the platform.
    waitUntil(
      (async () => {
        try {
          logEvent("spectrum.handling", { id: message.id, type: message.content?.type });
          const msg = spectrumMessageToInbound(space, message);
          const inboundWasVoice = message.content?.type === "voice";
          const out = await processInbound(msg, makeSpectrumTransport(space), { inboundWasVoice });
          logEvent("spectrum.done", { id: message.id, status: out.status, branch: out.branch });
        } catch (e) {
          logEvent("spectrum.handler_error", { error: e instanceof Error ? e.message : String(e) });
        }
      })(),
    );
  });

  logEvent("spectrum.responding", { handlerCalled, status: response.status });
  return response;
}
