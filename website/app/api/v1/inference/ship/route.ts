import { authenticateApiBearer } from "@/lib/auth/api_tokens";
import { insertUsageRecord } from "@/lib/inference/db";
import { rateLimitToken } from "@/lib/inference/rate_limit";
import {
  DEFAULT_PLAN,
  type BuilderCheckerPlan,
  runTandem,
  type TandemEvent,
  type WorkspaceFile,
} from "@/lib/inference/tandem";
import { estimateTokens } from "@/lib/inference/tokens";
import { ensureWithinQuota, recordUsage } from "@/lib/usage/quota";
import { featureLocked, featureLockedBody } from "@/lib/feature_gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tandem ship: two builders (Sonnet + GPT-4o) in parallel, one checker
 * (Gemini) merges + validates the patchset. Streams TandemEvents back as
 * SSE so the IDE can render per-row progress.
 *
 * Quota: estimates ~3x a single-model turn (two builders + checker). Billed
 * against `token_buckets.tokens_used` at end of stream via one
 * `usage_records` row per model.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiBearer(request.headers.get("authorization"));
  if (!auth) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const rateLimited = rateLimitToken(auth.apiToken.id, { tier: auth.user.tier });
  if (rateLimited) return rateLimited;

  let body: ShipRequestBody;
  try {
    body = (await request.json()) as ShipRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (!body || typeof body.instructions !== "string" || !Array.isArray(body.workspaceFiles)) {
    return new Response(JSON.stringify({ error: "invalid_body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const plan = body.plan ?? DEFAULT_PLAN;

  // Pre-flight quota: estimate the payload size, multiply by ~3 to cover
  // two builders + checker. This is conservative; real usage records land
  // after streaming completes.
  const baseEstimate = estimateTokens({
    instructions: body.instructions,
    workspaceFiles: body.workspaceFiles,
  });
  const estimate = Math.max(2_000, baseEstimate * 3);
  // Paywall: the tandem builder/checker is multi-model — Pro+ and up.
  if (featureLocked(auth.user.tier, "multiModel")) {
    return new Response(JSON.stringify(featureLockedBody("multiModel")), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  const quota = await ensureWithinQuota(auth.user.id, auth.user.tier, estimate);
  if (!quota.ok) {
    return new Response(
      JSON.stringify({
        error: "over_quota",
        retryable: false,
        tier: auth.user.tier,
        remaining: 0,
      }),
      {
        status: 402,
        headers: { "content-type": "application/json" },
      },
    );
  }

  const warning = quota.status === "ghost_warning" ? "ghost" : null;

  // Stream the tandem iterator as SSE frames.
  const encoder = new TextEncoder();
  const userId = auth.user.id;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const started = Date.now();
      try {
        for await (const event of runTandem({
          instructions: body.instructions,
          workspaceFiles: body.workspaceFiles,
          plan,
        })) {
          // Emit the event to the client.
          controller.enqueue(encoder.encode(formatSSE(event)));

          // Side-effect: record usage rows as each model completes.
          if (event.kind === "builder_done" || event.kind === "checker_done") {
            recordPerModelUsage({
              userId,
              provider: event.provider,
              model: event.model,
              tokens_in: event.tokens.tokens_in,
              tokens_out: event.tokens.tokens_out,
              cost_usd_micros: event.cost_usd_micros,
              latency_ms: Date.now() - started,
            }).catch((error) => {
              console.error("ship.record_usage_failed", error);
            });
          } else if (event.kind === "builder_failed") {
            // Log failures with zero tokens so they show up in usage.
            insertUsageRecord({
              user_id: userId,
              provider: event.provider,
              model: event.model,
              intent: "ship",
              tokens_in: 0,
              tokens_out: 0,
              cost_usd_micros: 0,
              latency_ms: Date.now() - started,
              status: "error",
            }).catch((error) => {
              console.error("ship.record_failure_failed", error);
            });
          }
        }
      } catch (error) {
        console.error("ship.stream_failed", error);
        controller.enqueue(
          encoder.encode(
            formatSSE({
              kind: "ship_failed",
              reason: error instanceof Error ? error.message : "unknown_error",
            }),
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  const headers: Record<string, string> = {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  };
  if (warning === "ghost") {
    headers["x-eri-quota-warning"] = "ghost";
  }

  return new Response(stream, { status: 200, headers });
}

interface ShipRequestBody {
  instructions: string;
  workspaceFiles: WorkspaceFile[];
  plan?: BuilderCheckerPlan;
}

function formatSSE(event: TandemEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function recordPerModelUsage(input: {
  userId: string;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd_micros: number;
  latency_ms: number;
}): Promise<void> {
  await recordUsage({
    user_id: input.userId,
    provider: input.provider,
    model: input.model,
    intent: "ship",
    tokens_in: input.tokens_in,
    tokens_out: input.tokens_out,
    cost_usd_micros: input.cost_usd_micros,
    latency_ms: input.latency_ms,
    status: "ok",
  });
}
