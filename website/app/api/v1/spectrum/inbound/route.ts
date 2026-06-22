// POST /api/v1/spectrum/inbound — the Spectrum (Photon) webhook for eri.
//
// The "eri Everywhere" inbound surface. The SDK's `app.webhook()` verifies the
// HMAC signature itself (bad sig → 401) and hands us a fully-built `(space,
// message)`. The SDK dispatches that handler FIRE-AND-FORGET (it never awaits
// it), so on serverless we capture the handler's promise and AWAIT it before
// returning — otherwise the model call + reply would be killed when the function
// freezes. The actual work is the SAME shared `processInbound` Sendblue uses.

import { processInbound } from "@/lib/messaging/inbound_runtime";
import { logEvent } from "@/lib/messaging/inbound_runtime";
import { getSpectrumApp, makeSpectrumTransport, spectrumMessageToInbound } from "@/lib/messaging/spectrum";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const app = await getSpectrumApp();

  // The handler runs synchronously inside `webhook()` (before it resolves) — we
  // capture its promise so we can await the real work before responding.
  let work: Promise<unknown> | undefined;
  const response = await app.webhook(request, (space, message) => {
    work = (async () => {
      try {
        const msg = spectrumMessageToInbound(space, message);
        await processInbound(msg, makeSpectrumTransport(space));
      } catch (e) {
        logEvent("spectrum.handler_error", { error: e instanceof Error ? e.message : String(e) });
      }
    })();
  });

  if (work) await (work as Promise<unknown>).catch(() => {});
  return response;
}
