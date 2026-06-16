/**
 * Sendblue inbound-webhook verification + parsing (ADR-0002).
 *
 * Sendblue authenticates webhooks with a **shared secret** you configure, echoed
 * back in a request header (its exact name isn't documented). So verification is
 * a constant-time compare against `SENDBLUE_SIGNING_SECRET` — NOT a Stripe-style
 * body HMAC. We check the configured header and, defensively, any header whose
 * value matches the secret (header-name-agnostic; safe because the secret is
 * high-entropy and every compare is constant-time). Pure + unit-tested.
 */

import { timingSafeEqual } from "node:crypto";

/** Constant-time string equality (length mismatch short-circuits to false). */
export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Default header Sendblue is expected to use; overridable via env if confirmed. */
export const DEFAULT_SIGNING_HEADER = "sb-signing-secret";

/**
 * True iff any request header carries the configured shared secret.
 *
 * Sendblue echoes the configured secret in a request header (raw value, per
 * their docs) — but the exact header NAME is undocumented and varies, which made
 * an earlier name-prefix allowlist silently 401 a real delivery whose header
 * didn't match the guessed names. Since the secret is HIGH-ENTROPY (a 256-bit
 * token; nothing unrelated could ever equal it), it is safe to accept it in the
 * configured header OR ANY header whose value carries it — also tolerating a
 * "Bearer <secret>" wrapper. Every compare is constant-time.
 */
export function verifySendblueSecret(
  headers: Record<string, string>,
  expected: string,
  headerName: string = DEFAULT_SIGNING_HEADER,
): boolean {
  if (!expected) return false;
  const carries = (value: string | undefined): boolean => {
    if (!value) return false;
    if (constantTimeEquals(value, expected)) return true;
    // tolerate "Bearer <secret>" / "<scheme> <secret>" wrappers
    const space = value.lastIndexOf(" ");
    return space >= 0 && constantTimeEquals(value.slice(space + 1), expected);
  };
  // Configured header first (fast path), then any header (high-entropy ⇒ safe).
  if (carries(headers[headerName.toLowerCase()])) return true;
  return Object.values(headers).some(carries);
}

export interface InboundMessage {
  fromNumber: string;
  content: string;
  messageHandle: string;
  isOutbound: boolean;
  service: string;
}

/**
 * Parse a Sendblue inbound payload into the fields we use. Returns null when the
 * essentials (`from_number`, `message_handle`) are missing, so a malformed POST
 * is rejected rather than half-processed.
 */
export function parseInbound(body: unknown): InboundMessage | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const fromNumber = typeof b.from_number === "string" ? b.from_number : null;
  const messageHandle = typeof b.message_handle === "string" ? b.message_handle : null;
  if (!fromNumber || !messageHandle) return null;
  return {
    fromNumber,
    content: typeof b.content === "string" ? b.content : "",
    messageHandle,
    isOutbound: b.is_outbound === true,
    service: typeof b.service === "string" ? b.service : "iMessage",
  };
}
