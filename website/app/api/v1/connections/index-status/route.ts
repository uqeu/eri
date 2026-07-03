import { NextResponse } from "next/server";
import { userFromBearer } from "@/lib/auth";
import { listConnections } from "@/lib/composio/accounts";
import { summarizeIndex } from "@/lib/connections/index_status";
import { readRecallProjection } from "@/lib/messaging/recall";
import { rateLimit } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/connections/index-status — a SAFE summary of what eri has indexed
 * about the logged-in user, for the onboarding "watch eri learn your world" view.
 *
 * SESSION-authed (web JWT), distinct from the bearer-only GET /api/v1/memory/recall:
 * the onboarding page is a browser session, not an eri_sk_ caller. Single-principal
 * (the session user's own world model only). Returns counts + entity names/kinds
 * only — no observation text, no sensitive content; the brain's Q23 / refusal
 * boundary is untouched.
 */
export async function GET(request: Request): Promise<Response> {
  const limited = await rateLimit(request, "connections.index_status");
  if (limited) return limited;

  const user = await userFromBearer(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [projection, connections] = await Promise.all([
    readRecallProjection(user.id),
    listConnections(user.id).catch(() => []),
  ]);
  const connected = connections.filter((c) => c.status === "active").map((c) => c.toolkit);

  return NextResponse.json(summarizeIndex(projection, connected));
}
