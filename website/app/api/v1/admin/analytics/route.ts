// GET /api/v1/admin/analytics?days=30&top=50
//
// Cross-user usage analytics + recent audit feed. Admin-only: the caller must
// resolve to a user with users.is_admin = true. Accepts either a dashboard JWT
// or a CLI api-token bearer. Returns NO prompt/response content.

import { NextResponse } from "next/server";

import { authenticateApiBearer } from "@/lib/auth/api_tokens";
import { userFromBearer } from "@/lib/auth";
import type { UserRow } from "@/lib/db";
import { recentAudit } from "@/lib/audit";
import { adminAnalytics } from "@/lib/usage/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolve the caller from a dashboard JWT or a CLI api-token. */
async function resolveUser(authHeader: string | null): Promise<UserRow | null> {
  const viaJwt = await userFromBearer(authHeader);
  if (viaJwt) return viaJwt;
  const viaToken = await authenticateApiBearer(authHeader);
  return viaToken?.user ?? null;
}

function intParam(url: URL, key: string, fallback: number): number {
  const raw = url.searchParams.get(key);
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(request: Request): Promise<NextResponse> {
  const user = await resolveUser(request.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!user.is_admin) {
    // Same shape as not-found: never reveal the endpoint to non-admins.
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const url = new URL(request.url);
  const days = intParam(url, "days", 30);
  const top = intParam(url, "top", 50);

  try {
    const [analytics, audit] = await Promise.all([
      adminAnalytics(days, top),
      recentAudit(100),
    ]);
    return NextResponse.json({ ...analytics, audit }, { status: 200 });
  } catch (error: unknown) {
    console.error("[admin/analytics] failed", error);
    return NextResponse.json(
      { error: "Failed to load analytics." },
      { status: 500 },
    );
  }
}
