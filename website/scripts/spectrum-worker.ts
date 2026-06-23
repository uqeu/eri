/**
 * eri Spectrum streaming worker ("eri Everywhere" M1).
 *
 * The managed free/shared iMessage line delivers inbound over a LIVE streaming
 * connection (the model Photon's quickstart uses with `bun start`), not a
 * standalone webhook — so a registered webhook on the free line stays silent.
 * This small always-on consumer holds `app.messages` and runs the EXACT same
 * brain the webhook route does: it reuses `processInbound` + the Spectrum
 * transport verbatim.
 *
 *   Run it locally:  cd website && npx tsx scripts/spectrum-worker.ts
 *   (needs PHOTON_PROJECT_ID + PHOTON_PROJECT_SECRET — auto-loaded from .env.local)
 *
 * Then text the line and eri replies with the real brain. Host it on Railway/Fly
 * for always-on once verified.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Load .env.local (KEY=VALUE lines) into process.env so the worker has the
// Photon credentials without a separate export step. Existing env wins.
try {
  for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // no .env.local — rely on the real environment
}

import { processInbound } from "@/lib/messaging/inbound_runtime";
import { getSpectrumApp, makeSpectrumTransport, spectrumMessageToInbound } from "@/lib/messaging/spectrum";

async function main(): Promise<void> {
  const app = await getSpectrumApp();
  console.log("[eri] Spectrum streaming worker connected — listening for messages…");

  for await (const [space, message] of app.messages) {
    // Handle each message without blocking the stream — one slow turn must not
    // stall the next inbound. processInbound owns dedup/meter/send.
    void (async () => {
      try {
        const msg = spectrumMessageToInbound(space, message);
        const inboundWasVoice = message.content.type === "voice";
        const out = await processInbound(msg, makeSpectrumTransport(space), { inboundWasVoice });
        console.log(`[eri] handled ${message.id}: ${out.status}${out.branch ? " / " + out.branch : ""}`);
      } catch (e) {
        console.error("[eri] worker error:", e instanceof Error ? e.message : e);
      }
    })();
  }
}

main().catch((e) => {
  console.error("[eri] worker fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
