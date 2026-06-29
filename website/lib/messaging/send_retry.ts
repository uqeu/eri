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

export async function withSendRetry(
  send: () => Promise<unknown>,
  attempts: number = SEND_ATTEMPTS,
  backoff: (attempt: number) => Promise<void> = (n) => sleep(150 * n),
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
