// POST /api/composio/connect — start linking a toolkit for the signed-in user.
//
// Transport only — the decision lives in `handleConnect` (lib/composio/connect).
// Authenticated by the user's eri_sk_ bearer and gated to the `mcp` (Pro+)
// feature, since Composio connectors are the custom-MCP surface. Returns the
// hosted Composio OAuth URL the user opens to authorize.

import { NextResponse } from "next/server";
import { upsertConnection } from "@/lib/composio/accounts";
import { composioCaller } from "@/lib/composio/auth";
import { ComposioApiClient } from "@/lib/composio/client";
import { handleConnect } from "@/lib/composio/connect";
import { featureLocked } from "@/lib/feature_gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const caller = await composioCaller(request.headers.get("authorization"));
  if (!caller) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (featureLocked(caller.tier, "mcp")) {
    return NextResponse.json({ error: "tier_locked", required: "pro_plus" }, { status: 402 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const toolkit = (body as { toolkit?: unknown })?.toolkit;

  const client = new ComposioApiClient();
  const outcome = await handleConnect(caller.id, toolkit, {
    initiate: (userId, tk) => client.initiateConnection(userId, tk),
    record: upsertConnection,
  });

  switch (outcome.branch) {
    case "ok":
      return NextResponse.json({ redirectUrl: outcome.redirectUrl });
    case "invalid_toolkit":
      return NextResponse.json({ error: "invalid_toolkit" }, { status: 400 });
    case "composio_error":
      return NextResponse.json({ error: "composio_unavailable" }, { status: 502 });
  }
}
