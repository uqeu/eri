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
 * True iff some request header carries the configured shared secret. Checks the
 * named header first, then any header value (constant-time), so a correct
 * integration verifies regardless of the exact header name Sendblue picks.
 */
export function verifySendblueSecret(
  headers: Record<string, string>,
  expected: string,
  headerName: string = DEFAULT_SIGNING_HEADER,
): boolean {
  if (!expected) return false;
  const direct = headers[headerName.toLowerCase()];
  if (direct && constantTimeEquals(direct, expected)) return true;
  for (const value of Object.values(headers)) {
    if (value && constantTimeEquals(value, expected)) return true;
  }
  return false;
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
