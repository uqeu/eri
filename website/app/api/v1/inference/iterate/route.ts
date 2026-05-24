import { runProxy } from "@/lib/inference/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mercury / diffusion edit proxy. Routes to Inception Labs and is FREE
 * for all tiers (the diffusion path costs us under half a cent per turn
 * per the local inference policy), so `bill: false`. We still log a
 * `usage_records` row with `cost_usd_micros = 0` for observability.
 *
 * User-facing name: "eri Engine" — never "Mercury 2" in responses.
 */
export async function POST(request: Request): Promise<Response> {
  return runProxy(request, {
    provider: "inception",
    intent: "iterate",
    bill: false,
  });
}
