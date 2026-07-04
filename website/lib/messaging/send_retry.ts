/**
 * Bounded send retry — SDK-free so it's unit-testable without loading the
 * Spectrum gRPC client (whose package export map can't be resolved by tsx).
 *
 * The Spectrum iMessage transport is a gRPC call whose deadline can elapse when
 * (a) the Photon token refresh stalls or (b) the serverless function defers the
 * send past its HTTP response via `waitUntil` — both surface as a transient send
 * failure on the FIRST attempt. Retrying in-window lets the reply self-heal in
 * this same invocation instead of vanishing (or only landing via a much-later
 * retry). Safe against double-sends: our failure modes (no valid token / aborted
 * call) fail BEFORE the message is accepted, so a retry re-sends nothing already
 * delivered. Throws the last error if every attempt fails.
 */

import { setTimeout as sleep } from "node:timers/promises";

/** How many times to attempt a single outbound send before giving up. */
export const SEND_ATTEMPTS = 3;

/** Sleep, clamped to >= 0 — a negative delay makes Node warn (TimeoutNegativeWarning,
 *  "Timeout set to 1") and is never intended. */
function clampedSleep(ms: number): Promise<void> {
  return sleep(Math.max(0, Number.isFinite(ms) ? ms : 0));
}

/**
 * True when a send failed because the Photon session token is DEAD (tokenExpired /
 * UNAUTHENTICATED) — the signal to re-exchange a fresh token and retry, rather than
 * go silent. Pure + SDK-free (matches on the error's code/message/cause) so it's
 * unit-tested without loading the gRPC client.
 */
export function isTokenExpired(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown; cause?: unknown } | null;
  const code = String(err?.code ?? "").toLowerCase();
  const cause = err?.cause;
  const causeMsg = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  const hay = `${typeof err?.message === "string" ? err.message : ""} ${causeMsg}`.toLowerCase();
  return (
    code === "tokenexpired" ||
    hay.includes("tokenexpired") ||
    hay.includes("unauthenticated") ||
    hay.includes("authentication failed")
  );
}

export async function withSendRetry(
  send: () => Promise<unknown>,
  attempts: number = SEND_ATTEMPTS,
  backoff: (attempt: number) => Promise<void> = (n) => clampedSleep(150 * n),
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await send();
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < attempts) await backoff(attempt);
    }
  }
  throw lastErr;
}
