// POST /api/composio/disconnect — drop a toolkit the signed-in user connected.
//
// Transport only — the decision lives in `handleDisconnect` (lib/composio/connect).
// Revokes the connected account at Composio (deleting its stored tokens) and
// forgets our own row. Same auth + tier gate as the connect route.

import { NextResponse } from "next/server";
import { deleteConnection, findConnection } from "@/lib/composio/accounts";
import { composioCaller } from "@/lib/composio/auth";
import { ComposioApiClient } from "@/lib/composio/client";
import { handleDisconnect } from "@/lib/composio/connect";
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
  const outcome = await handleDisconnect(caller.id, toolkit, {
    find: findConnection,
    revoke: (id) => client.disconnect(id),
    remove: deleteConnection,
  });

  switch (outcome.branch) {
    case "ok":
      return NextResponse.json({ ok: true });
    case "invalid_toolkit":
      return NextResponse.json({ error: "invalid_toolkit" }, { status: 400 });
    case "not_connected":
      return NextResponse.json({ error: "not_connected" }, { status: 404 });
    case "composio_error":
      return NextResponse.json({ error: "composio_unavailable" }, { status: 502 });
  }
}
