import { NextResponse } from "next/server";
import { authenticateApiBearer } from "@/lib/auth/api_tokens";
import { runProxy } from "@/lib/inference/proxy";
import {
  ensureMercuryTurnAvailable,
  recordMercuryTurn,
} from "@/lib/usage/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mercury / diffusion edit proxy. Routes to Inception Labs and is FREE
 * for all tiers at the provider level (the diffusion path costs us under
 * half a cent per turn per the local inference policy), so `bill: false`
 * in `runProxy` — frontier tokens are untouched. We still rate-limit per
 * tier via `mercury_turns_used` to keep Free abuse bounded; see
 * `MERCURY_TURN_LIMITS` in `lib/tiers.ts`.
 *
 * BYOK requests (`x-eri-byok: true`) bypass the Mercury limiter entirely —
 * the user is using their own Inception key, we have no cost to gate.
 *
 * User-facing name: "eri Engine" — never "Mercury 2" in responses.
 */
export async function POST(request: Request): Promise<Response> {
  const bypassRateLimit = request.headers.get("x-eri-byok") === "true";

  if (!bypassRateLimit) {
    const auth = await authenticateApiBearer(request.headers.get("authorization"));
    if (!auth) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const check = await ensureMercuryTurnAvailable(auth.user.id, auth.user.tier);
    if (!check.ok) {
      return NextResponse.json(
        {
          error: "mercury_quota_exhausted",
          retryable: false,
          used: check.used,
          limit: check.limit,
          resetAt: check.resetAt.toISOString(),
        },
        { status: 402 },
      );
    }
  }

  const response = await runProxy(request, {
    provider: "inception",
    intent: "iterate",
    bill: false,
  });

  if (response.ok && !bypassRateLimit) {
    const auth = await authenticateApiBearer(request.headers.get("authorization"));
    if (auth) {
      recordMercuryTurn(auth.user.id).catch((error) => {
        console.error("iterate.record_mercury_failed", error);
      });
    }
  }

  return response;
}
