// POST /api/v1/imessage/inbound — the Sendblue webhook for phone eri (ADR-0002).
//
// Transport only — verify Sendblue's shared secret, parse, rate-limit, then hand
// off to the shared `processInbound` (lib/messaging/inbound_runtime), which owns
// the dedup lease → handleInbound → meter → send orchestration for EVERY
// provider. Sendblue's `InboundTransport` is just "how to show typing + send a
// reply to this phone number". The brain + orchestration are shared with Spectrum.

import { NextResponse } from "next/server";
import { normalizeE164 } from "@/lib/imessage/identity";
import { sendReply, sendTypingIndicator } from "@/lib/imessage/provider";
import { DEFAULT_SIGNING_HEADER, parseInbound, verifySendblueSecret } from "@/lib/imessage/webhook";
import { processInbound, type InboundTransport } from "@/lib/messaging/inbound_runtime";
import { rateLimitKey } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  const headers = Object.fromEntries(request.headers.entries());
  const secret = process.env.SENDBLUE_SIGNING_SECRET ?? "";
  const headerName = process.env.SENDBLUE_SIGNING_HEADER ?? DEFAULT_SIGNING_HEADER;
  if (!verifySendblueSecret(headers, secret, headerName)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const msg = parseInbound(body);
  if (!msg) return NextResponse.json({ error: "bad_payload" }, { status: 400 });
  if (msg.isOutbound) return NextResponse.json({ ok: true, skipped: "outbound" });

  const e164 = normalizeE164(msg.fromNumber);
  if (!e164) return NextResponse.json({ ok: true, skipped: "bad_number" });

  // Per-sender rate limit (the webhook shares Sendblue's IP, so we key on the
  // sender number, not the IP) — review M1.
  const limited = await rateLimitKey("imessage.inbound", e164);
  if (limited) return limited;

  const transport: InboundTransport = {
    sendTyping: () => sendTypingIndicator(e164).then(() => {}),
    sendReply: (chunks) => sendReply(e164, chunks),
  };
  const outcome = await processInbound(msg, transport);

  switch (outcome.status) {
    case "handled":
      return NextResponse.json({ ok: true, branch: outcome.branch });
    case "duplicate":
      return NextResponse.json({ ok: true, skipped: "duplicate" });
    case "skipped_outbound":
      return NextResponse.json({ ok: true, skipped: "outbound" });
    case "skipped_empty":
      return NextResponse.json({ ok: true, skipped: "empty" });
    case "bad_number":
      return NextResponse.json({ ok: true, skipped: "bad_number" });
    case "send_failed":
      return NextResponse.json({ error: "send_failed" }, { status: 502 });
    case "error":
      return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
