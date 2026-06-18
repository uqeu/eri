// GET /api/composio/toolkits — Composio's full connector catalog (~900 apps).
//
// Transport only. Powers the dynamic connections UI so there's no hand-kept app
// list. Auth-gated to the `mcp` (Pro+) feature like the connect route, since
// connectors are the custom-MCP surface. The catalog is the SAME for every user
// (it's the global app list — per-user connection status is overlaid client-side
// from /api/composio/status), so it's cached briefly at the edge.

import { NextResponse } from "next/server";
import { composioCaller } from "@/lib/composio/auth";
import { ComposioApiClient } from "@/lib/composio/client";
import { featureLocked } from "@/lib/feature_gate";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const caller = await composioCaller(request.headers.get("authorization"));
  if (!caller) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (featureLocked(caller.tier, "mcp")) {
    return NextResponse.json({ error: "tier_locked", required: "pro_plus" }, { status: 402 });
  }

  try {
    const toolkits = await new ComposioApiClient().listToolkits();
    return NextResponse.json(
      { toolkits },
      // Global catalog — cache 10 min at the edge, serve stale while revalidating.
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400" } },
    );
  } catch {
    return NextResponse.json({ error: "composio_unavailable" }, { status: 502 });
  }
}
