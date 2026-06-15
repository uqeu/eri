// GET /api/composio/status — the signed-in user's connected toolkits.
//
// Strictly user-scoped: a bearer only ever sees its own connections. Used by the
// connect-apps UI to render which toolkits are linked, pending, or errored.

import { NextResponse } from "next/server";
import { authenticateApiBearer } from "@/lib/auth/api_tokens";
import { listConnections, upsertConnection } from "@/lib/composio/accounts";
import { ComposioApiClient } from "@/lib/composio/client";
import { listFreshConnections } from "@/lib/composio/connect";
import { featureLocked } from "@/lib/feature_gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiBearer(request.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (featureLocked(auth.user.tier, "mcp")) {
    return NextResponse.json({ error: "tier_locked", required: "pro_plus" }, { status: 402 });
  }
  // Refresh still-pending accounts from Composio so a connection authorized on
  // its hosted page actually flips to active (review #3 — no backend callback).
  const client = new ComposioApiClient();
  const connections = await listFreshConnections(auth.user.id, {
    list: listConnections,
    status: (id) => client.connectionStatus(id),
    record: upsertConnection,
  });
  return NextResponse.json({ connections });
}
