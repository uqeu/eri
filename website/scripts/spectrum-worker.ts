/**
 * eri Spectrum streaming worker — the ALWAYS-ON iMessage host ("eri Everywhere").
 *
 * The dedicated business line delivers inbound over a LIVE streaming connection
 * (Photon's `bun start` model), not a webhook — so eri is only reachable while a
 * process holds `app.messages`. On a laptop that dies when the Mac sleeps; on
 * Railway it stays connected 24/7. This consumer runs the EXACT same brain the
 * webhook route does: it reuses `processInbound` + the Spectrum transport verbatim.
 *
 * Never silently dies: a dropped stream reconnects with capped exponential backoff
 * (a fresh app + token each time), and SIGTERM/SIGINT shut down cleanly so Railway
 * redeploys without dropping mid-flight.
 *
 *   Local run:   cd website && bun run scripts/spectrum-worker.ts
 *   Railway:     see railway.json + Dockerfile.worker (bun runtime).
 *   Needs (min): PHOTON_PROJECT_ID, PHOTON_PROJECT_SECRET, DATABASE_URL,
 *                ANTHROPIC_MASTER_KEY, ERI_SERVER_ENCRYPTION_KEY.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Load .env.local (KEY=VALUE) into process.env for LOCAL runs only — Railway
// injects env directly, so a missing file is fine. Existing env always wins.
try {
  for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // no .env.local — rely on the real environment (Railway)
}

import { processInbound } from "@/lib/messaging/inbound_runtime";
import {
  getSpectrumApp,
  makeSpectrumTransport,
  resetSpectrumApp,
  spectrumMessageToInbound,
} from "@/lib/messaging/spectrum";

/** Reconnect backoff bounds, and the "this connection was healthy" threshold that
 *  resets the backoff (so a long-lived stream that finally drops retries fast, but
 *  a flapping line doesn't hammer Photon). */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const HEALTHY_MS = 60_000;
const HEARTBEAT_MS = 15 * 60_000;

let shuttingDown = false;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Hold one streaming connection and dispatch each inbound to the real brain.
 * Returns (stream closed) or throws (drop) only when the connection ends, so the
 * caller reconnects. Each message is handled OFF the stream loop so one slow turn
 * never stalls the next inbound — `processInbound` owns dedup/meter/send.
 */
async function consumeStream(): Promise<void> {
  const app = await getSpectrumApp();
  console.log("[eri] worker connected — listening for messages…");
  for await (const [space, message] of app.messages) {
    void (async () => {
      try {
        const msg = spectrumMessageToInbound(space, message);
        const inboundWasVoice = message.content.type === "voice";
        const out = await processInbound(msg, makeSpectrumTransport(space), { inboundWasVoice });
        console.log(`[eri] handled ${message.id}: ${out.status}${out.branch ? " / " + out.branch : ""}`);
      } catch (e) {
        console.error("[eri] message error:", errMsg(e));
      }
    })();
  }
  // The async-iterator completed → the server closed the stream. Treat as a drop
  // so the reconnect loop re-establishes it.
  throw new Error("message stream ended");
}

/** Run forever: (re)connect, and on any drop wait (capped exp backoff + jitter)
 *  then rebuild a fresh app and resume. The only ways out are a shutdown signal. */
async function main(): Promise<void> {
  let backoff = RECONNECT_BASE_MS;
  while (!shuttingDown) {
    const startedAt = Date.now();
    try {
      await consumeStream();
    } catch (e) {
      console.error("[eri] stream dropped:", errMsg(e));
    }
    if (shuttingDown) break;

    // A connection that lasted a while was healthy → retry immediately; a quick
    // drop grows the backoff so a broken line isn't hammered.
    if (Date.now() - startedAt > HEALTHY_MS) backoff = RECONNECT_BASE_MS;
    const wait = Math.min(backoff, RECONNECT_MAX_MS) * (0.5 + Math.random());
    console.log(`[eri] reconnecting in ${Math.round(wait)}ms…`);
    await sleep(wait);
    backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
    resetSpectrumApp(); // fresh app + token on reconnect
  }
  console.log("[eri] worker stopped.");
}

// Visible liveness in the logs even on a totally idle line (the real "no inbound
// in N hours" alarm is a separate monitoring task).
const heartbeat = setInterval(
  () => console.log(`[eri] heartbeat — alive ${new Date().toISOString()}`),
  HEARTBEAT_MS,
);
heartbeat.unref?.();

// Clean shutdown so Railway redeploys without a hard kill mid-message.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`[eri] ${signal} received — shutting down…`);
    shuttingDown = true;
    setTimeout(() => process.exit(0), 1_000);
  });
}

main().catch((e) => {
  // A truly fatal, unhandled error → exit non-zero so Railway restarts us.
  console.error("[eri] worker fatal:", errMsg(e));
  process.exit(1);
});
