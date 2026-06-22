/**
 * Spectrum (Photon) inbound-webhook verification + parsing — "eri Everywhere" M1.
 *
 * Spectrum signs each delivery Slack-style: an `X-Spectrum-Signature` of
 * `HMAC-SHA256(secret, "v0:" + timestamp + ":" + rawBody)` as lowercase hex with
 * a `v0=` prefix, plus an `X-Spectrum-Timestamp` (unix seconds) for replay
 * protection. We verify over the EXACT raw bytes (not re-serialized JSON) and
 * reject anything outside a 5-minute window.
 *
 * The body is `{ event: "messages", space, message }`. We map it onto the
 * existing `InboundMessage` shape so `handleInbound` (the transport-agnostic
 * brain) is reused UNCHANGED, and additionally surface the Spectrum context
 * (space id, group-ness, attachment ref) the route needs for replies, vision,
 * and — later — group handling. Pure + unit-tested; the route owns transport.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { InboundMessage } from "@/lib/imessage/webhook";

/** Reject deliveries whose signed timestamp is older/newer than this (replay guard). */
export const REPLAY_WINDOW_SEC = 5 * 60;

/** Constant-time equality over two strings (length mismatch short-circuits). */
function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a Spectrum webhook signature. `now` (ms) is injectable for tests.
 * Returns false on any missing input, a stale timestamp, or a mismatch — never
 * throws, so a bad delivery is a clean 401 rather than a 500.
 */
export function verifySpectrumSignature(args: {
  rawBody: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  secret: string;
  now?: number;
}): boolean {
  const { rawBody, signature, timestamp, secret } = args;
  if (!signature || !timestamp || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSec = (args.now ?? Date.now()) / 1000;
  if (Math.abs(nowSec - ts) > REPLAY_WINDOW_SEC) return false;
  // Sign over the literal timestamp string + raw body, exactly as Spectrum did.
  const expected =
    "v0=" + createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  return constantTimeEquals(expected, signature);
}

/** A parsed Spectrum delivery: a `handleInbound`-ready message plus the Spectrum
 *  context the route needs (reply target, group flag, attachment to resolve). */
export interface SpectrumInbound {
  /** Mapped to the existing InboundMessage so handleInbound is reused as-is. */
  message: InboundMessage;
  /** Conversation id — the reply target, and the key for per-group state. */
  spaceId: string;
  /** True for a group chat (vs a 1:1 DM). */
  isGroup: boolean;
  /** Source platform ("iMessage", "whatsapp", …). */
  platform: string;
  /** Spectrum's `content.type` discriminator (text | attachment | reaction | …). */
  contentType: string;
  /** Present when the message carried an attachment. The webhook ships metadata
   *  only (no bytes/URL), so the route resolves the actual media via the API
   *  before any vision turn. */
  attachment?: { id: string; mimeType: string; name?: string };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

/**
 * Parse a Spectrum `messages` delivery. Returns null when it isn't a usable
 * inbound message (wrong event, missing space/message/id, or unparseable sender)
 * so a malformed POST is rejected rather than half-processed. Non-text content
 * (attachment, richlink) maps sensibly; reactions and other kinds parse with an
 * empty body and their `contentType` set so the route can decide what to do.
 */
export function parseSpectrumInbound(body: unknown): SpectrumInbound | null {
  const b = asRecord(body);
  if (!b || b.event !== "messages") return null;
  const space = asRecord(b.space);
  const message = asRecord(b.message);
  if (!space || !message) return null;

  const spaceId = typeof space.id === "string" ? space.id : null;
  const messageId = typeof message.id === "string" ? message.id : null;
  if (!spaceId || !messageId) return null;

  const platform =
    typeof space.platform === "string"
      ? space.platform
      : typeof message.platform === "string"
        ? message.platform
        : "iMessage";
  const isGroup = space.type === "group";

  // Sender handle: the message sender's id (a phone/email for iMessage). Fall
  // back to the space phone for a 1:1 line. Required — no sender, no message.
  const sender = asRecord(message.sender);
  const senderId =
    sender && typeof sender.id === "string"
      ? sender.id
      : typeof space.phone === "string" && space.phone !== "shared"
        ? space.phone
        : null;
  if (!senderId) return null;

  const content = asRecord(message.content);
  const contentType = content && typeof content.type === "string" ? content.type : "unknown";

  let text = "";
  let attachment: SpectrumInbound["attachment"];
  if (content) {
    if (contentType === "text" && typeof content.text === "string") {
      text = content.text;
    } else if (contentType === "richlink" && typeof content.url === "string") {
      // A shared link reads as text to the brain (it can act on the URL).
      text = content.url;
    } else if (contentType === "attachment" && typeof content.id === "string") {
      attachment = {
        id: content.id,
        mimeType: typeof content.mimeType === "string" ? content.mimeType : "",
        name: typeof content.name === "string" ? content.name : undefined,
      };
    }
  }

  // `direction` is "inbound" for webhooks; treat anything else as an echo.
  const isOutbound = message.direction !== undefined && message.direction !== "inbound";

  const inbound: InboundMessage = {
    fromNumber: senderId,
    content: text,
    messageHandle: messageId,
    isOutbound,
    service: platform,
  };

  return { message: inbound, spaceId, isGroup, platform, contentType, attachment };
}
