import { NextResponse } from "next/server";
import { authenticateApiBearer } from "@/lib/auth/api_tokens";
import { autoIndexAllowed } from "@/lib/connections/autoindex_gate";
import { makeConnectorDeps } from "@/lib/connections/connector_deps";
import { DEFAULT_LIMIT, fetchObservations } from "@/lib/connections/observations";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/connections/observations?since=<ms>&limit=<n>
 *
 * The auto-index "dreaming" loop (ADR-0012) PULLS normalized connected-account
 * observations from here, Q23-screens them, and ingests them into the world model.
 *
 * PASS-THROUGH, never a store: read the bearer's OWN Gmail / Calendar live via
 * Composio, normalize to one-liners, return — NOTHING is persisted on this side
 * (data lives nowhere → nothing to leak). Strictly single-principal: only the
 * authenticated bearer's own connections (same posture as /memory/recall).
 * Contract: docs/contracts/connections-source-contract.md.
 */
export async function GET(request: Request): Promise<Response> {
  const limited = await rateLimit(request, "connections.observations");
  if (limited) return limited;

  const auth = await authenticateApiBearer(request.headers.get("authorization"));
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Rollout gate: don't index a real inbox at scale until the brain's precision
  // pass is broadly validated. Off → empty + gated:true (distinct from "no data").
  if (!autoIndexAllowed(auth.user.id, auth.user.email)) {
    return NextResponse.json({ observations: [], nextCursor: null, gated: true });
  }

  const url = new URL(request.url);
  const since = parseIntParam(url.searchParams.get("since"), 0);
  // `before` (ms) walks BACKWARD through history: pass the previous nextCursor to
  // page from newest toward oldest. 0/absent → newest overall.
  const before = parseIntParam(url.searchParams.get("before"), 0);
  const limit = parseIntParam(url.searchParams.get("limit"), DEFAULT_LIMIT);

  const result = await fetchObservations(auth.user.id, makeConnectorDeps(), {
    since,
    before: before > 0 ? before : null,
    limit,
  });
  return NextResponse.json(result);
}

function parseIntParam(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}
