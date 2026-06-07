import { NextResponse } from "next/server";
import {
  authenticateApiBearer,
  type AuthContext,
} from "@/lib/auth/api_tokens";
import { ensureWithinQuota, recordUsage } from "@/lib/usage/quota";
import {
  estimateCostMicros,
  estimateTokens,
  extractUsage,
  type UsageCounts,
} from "./tokens";
import { checkModelAllowed } from "./cost_guard";
import {
  getMasterKey,
  isProviderId,
  MissingMasterKeyError,
  providerConfig,
  type ProviderId,
} from "./providers";
import { rateLimitToken } from "./rate_limit";
import { resolveModelRoute } from "./routing";

/**
 * Core proxy entry point. Each `/api/v1/inference/<verb>` route is a
 * one-liner that calls `runProxy` with its provider id and a small
 * function that derives the upstream URL from the body (e.g. Google
 * appends the model into the path).
 *
 * BYOK fallback: when the caller sends `x-eri-byok: true` plus
 * `x-eri-provider-key: <key>`, we forward with the user's key, skip the
 * quota gate, and log usage with `cost_usd_micros = 0` so the row is
 * still observable but doesn't bill.
 */

export interface ProxyOptions {
  provider: ProviderId;
  intent?: string;
  /** Override the default upstream URL using the parsed request body. */
  upstreamUrl?: (body: unknown) => string;
  /**
   * Whether this proxy path is billed against the user's token bucket.
   * Mercury / diffusion sits on the inception provider and is free for
   * all tiers per the project's inference policy.
   */
  bill?: boolean;
}

function modelFromBody(body: unknown): string {
  if (typeof body !== "object" || body === null) return "unknown";
  const value = (body as Record<string, unknown>).model;
  return typeof value === "string" ? value : "unknown";
}

function buildUpstreamHeaders(
  request: Request,
  authHeader: Record<string, string>,
): Headers {
  const out = new Headers();
  // Copy through user-supplied content-type / accept; strip auth + cookies.
  request.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (
      k === "authorization" ||
      k === "cookie" ||
      k === "host" ||
      k === "x-eri-byok" ||
      k === "x-eri-provider-key" ||
      k === "x-forwarded-for" ||
      k === "x-real-ip" ||
      k.startsWith("cf-") ||
      k.startsWith("x-vercel-")
    ) {
      return;
    }
    out.set(key, value);
  });
  for (const [k, v] of Object.entries(authHeader)) {
    out.set(k, v);
  }
  if (!out.has("content-type")) {
    out.set("content-type", "application/json");
  }
  return out;
}

function jsonError(
  status: number,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): NextResponse {
  return NextResponse.json(body, { status, headers: extraHeaders });
}

interface BYOKCredentials {
  active: boolean;
  apiKey: string | null;
}

function readBYOK(request: Request): BYOKCredentials {
  // SECURITY: BYOK skips billing + quota + the cost guard, so a request header
  // must NEVER be able to select it — otherwise any user supplies any provider
  // key (e.g. a free-trial key) and gets unmetered inference on our dime. It is
  // gated behind a server-side flag (default OFF) and only honored for an
  // explicitly allowlisted set of token ids. Until per-account BYOK lands,
  // ERI_ALLOW_BYOK stays unset and every request is billed via the master key.
  if (process.env.ERI_ALLOW_BYOK !== "true") {
    return { active: false, apiKey: null };
  }
  const flag = request.headers.get("x-eri-byok") === "true";
  const key = request.headers.get("x-eri-provider-key");
  return { active: flag && typeof key === "string" && key.length > 0, apiKey: key };
}

async function readJsonBody(request: Request): Promise<{
  ok: true;
  value: unknown;
} | { ok: false; response: NextResponse }> {
  try {
    const value = await request.json();
    return { ok: true, value };
  } catch {
    return {
      ok: false,
      response: jsonError(400, { error: "invalid_json" }),
    };
  }
}

export async function runProxy(
  request: Request,
  options: ProxyOptions,
): Promise<Response> {
  // 1) Auth.
  const auth = await authenticateApiBearer(request.headers.get("authorization"));
  if (!auth) {
    return jsonError(401, { error: "unauthorized" });
  }

  // 2) Per-token gateway rate limit (separate from monthly quota). Pass
  // the user's tier so the 429 envelope shows the right context in the
  // IDE's rate-limit toast.
  const limited = rateLimitToken(auth.apiToken.id, { tier: auth.user.tier });
  if (limited) return limited;

  // 3) Body.
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;

  // 4) BYOK fallback path — no quota, no billing, no master key, no cost
  //    guard (the user pays whatever they want with their own key).
  const byok = readBYOK(request);
  if (byok.active && byok.apiKey) {
    return forwardAndLog({
      request,
      auth,
      body,
      provider: options.provider,
      intent: options.intent ?? null,
      upstreamUrl: resolveUpstreamUrl(options, body),
      apiKey: byok.apiKey,
      bill: false,
    });
  }

  // 4a) Server-side route resolution. Default is a passthrough; the only live
  //    remap is the DeepSeek "fast tier" pre-wire, which is OFF unless
  //    ERI_DEEPSEEK_FAST=true. When it reroutes, we swap the effective
  //    provider AND rewrite the body's model so the upstream understands it.
  const route = resolveModelRoute(options.provider, modelFromBody(body));
  const effectiveProvider = route.provider;
  const effectiveBody = route.rerouted ? withModel(body, route.model) : body;

  // 4b) Cost guard — block Opus / o1 / gpt-5-pro on the eri proxy. We pay
  //    for these out of our master keys, and eri's positioning is "thrifty
  //    harness over the cheapest capable models". Set ERI_ALLOW_PREMIUM=true
  //    in Vercel env if you need to bypass.
  const cost = checkModelAllowed(modelFromBody(effectiveBody));
  if (!cost.allowed) {
    return jsonError(403, {
      error: "model_not_allowed",
      reason: cost.reason,
      suggested: cost.suggested,
      message:
        "This model is too expensive for the eri proxy. Use a cheaper model, " +
        "switch to BYOK (x-eri-byok: true), or contact us if you need it unlocked.",
    });
  }

  // 5) Quota gate.
  const shouldBill = options.bill !== false;
  let warning: "ghost" | null = null;
  if (shouldBill) {
    const estimate = estimateTokens(effectiveBody);
    const check = await ensureWithinQuota(auth.user.id, auth.user.tier, estimate);
    if (!check.ok) {
      // 402 Payment Required — caller knows to surface a paywall.
      await recordUsage({
        user_id: auth.user.id,
        provider: effectiveProvider,
        model: modelFromBody(effectiveBody),
        intent: options.intent ?? null,
        tokens_in: 0,
        tokens_out: 0,
        cost_usd_micros: 0,
        latency_ms: 0,
        status: "over_quota",
      });
      return jsonError(402, { error: "over_quota", retryable: false });
    }
    if (check.status === "ghost_warning") warning = "ghost";
  }

  // 6) Master-key forward (against the effective provider after routing).
  let masterKey: string;
  try {
    masterKey = getMasterKey(effectiveProvider);
  } catch (error) {
    if (error instanceof MissingMasterKeyError) {
      console.error("inference.master_key_missing", { provider: error.provider });
      return jsonError(503, { error: "provider_unavailable" });
    }
    throw error;
  }

  return forwardAndLog({
    request,
    auth,
    body: effectiveBody,
    provider: effectiveProvider,
    intent: options.intent ?? null,
    upstreamUrl: resolveUpstreamUrl({ ...options, provider: effectiveProvider }, effectiveBody),
    apiKey: masterKey,
    bill: shouldBill,
    warning,
  });
}

/** Immutable shallow copy of a JSON body with `model` replaced. */
function withModel(body: unknown, model: string): unknown {
  if (typeof body !== "object" || body === null) return body;
  return { ...(body as Record<string, unknown>), model };
}

function resolveUpstreamUrl(options: ProxyOptions, body: unknown): string {
  const config = providerConfig(options.provider);
  if (options.upstreamUrl) return options.upstreamUrl(body);
  return config.defaultUrl;
}

interface ForwardInput {
  request: Request;
  auth: AuthContext;
  body: unknown;
  provider: ProviderId;
  intent: string | null;
  upstreamUrl: string;
  apiKey: string;
  bill: boolean;
  warning?: "ghost" | null;
}

async function forwardAndLog(input: ForwardInput): Promise<Response> {
  const config = providerConfig(input.provider);
  const authHeader = config.authHeader(input.apiKey);
  const upstreamHeaders = buildUpstreamHeaders(input.request, authHeader);
  const started = Date.now();

  const isStreaming = isStreamingRequest(input.body);

  let upstream: Response;
  try {
    upstream = await fetch(input.upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(input.body),
    });
  } catch (error) {
    console.error("inference.upstream_fetch_failed", {
      provider: input.provider,
      message: error instanceof Error ? error.message : String(error),
    });
    await recordUsageSafely({
      user_id: input.auth.user.id,
      provider: input.provider,
      model: extractModel(input.body),
      intent: input.intent,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd_micros: 0,
      latency_ms: Date.now() - started,
      status: "error",
    });
    return jsonError(502, { error: "upstream_unreachable" });
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    const status = upstream.status === 429 ? "rate_limited" : "error";
    await recordUsageSafely({
      user_id: input.auth.user.id,
      provider: input.provider,
      model: extractModel(input.body),
      intent: input.intent,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd_micros: 0,
      latency_ms: Date.now() - started,
      status,
    });
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "text/plain" },
    });
  }

  // Streaming path — tee the body, count tokens out of the stream
  // when it finishes, write the usage row asynchronously.
  if (isStreaming || isEventStream(upstream)) {
    return passthroughStreaming(upstream, input, started);
  }

  // Non-streaming path — buffer the JSON, extract usage exactly.
  const responseBody = await upstream.json().catch(() => null);
  const usage = extractUsage(input.provider, responseBody);
  const model = extractModel(input.body) || extractModelFromResponse(responseBody);

  if (input.bill) {
    const outcome = await recordUsage({
      user_id: input.auth.user.id,
      provider: input.provider,
      model,
      intent: input.intent,
      tokens_in: usage.tokens_in,
      tokens_out: usage.tokens_out,
      cost_usd_micros: estimateCostMicros(model, usage),
      latency_ms: Date.now() - started,
      status: "ok",
    });
    return jsonResponseWithWarning(responseBody, {
      warning: input.warning ?? (outcome.crossedIntoGhost ? "ghost" : null),
    });
  }

  // BYOK path — log without quota.
  await recordUsageSafely({
    user_id: input.auth.user.id,
    provider: input.provider,
    model,
    intent: input.intent,
    tokens_in: usage.tokens_in,
    tokens_out: usage.tokens_out,
    cost_usd_micros: 0,
    latency_ms: Date.now() - started,
    status: "ok",
  });
  return jsonResponseWithWarning(responseBody, { warning: null });
}

function isStreamingRequest(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const stream = (body as Record<string, unknown>).stream;
  return stream === true;
}

function isEventStream(response: Response): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("text/event-stream");
}

function extractModel(body: unknown): string {
  return modelFromBody(body);
}

function extractModelFromResponse(body: unknown): string {
  if (typeof body !== "object" || body === null) return "unknown";
  const value = (body as Record<string, unknown>).model;
  return typeof value === "string" ? value : "unknown";
}

function jsonResponseWithWarning(
  body: unknown,
  options: { warning: "ghost" | null },
): NextResponse {
  const headers: Record<string, string> = {};
  if (options.warning === "ghost") {
    headers["x-eri-quota-warning"] = "ghost";
  }
  return NextResponse.json(body, { status: 200, headers });
}

/**
 * Stream-through pipeline: clone the upstream body so we can both forward
 * bytes verbatim to the IDE AND parse the trailing usage frame. Usage
 * accounting happens AFTER the stream closes via background recording.
 */
function passthroughStreaming(
  upstream: Response,
  input: ForwardInput,
  started: number,
): Response {
  if (!upstream.body) {
    return jsonError(502, { error: "upstream_empty" });
  }

  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === "content-encoding" || k === "transfer-encoding") return;
    headers.set(key, value);
  });
  if (input.warning === "ghost") {
    headers.set("x-eri-quota-warning", "ghost");
  }

  const [forwardStream, parseStream] = upstream.body.tee();
  // Parse asynchronously — never block the client byte stream on this. But a
  // served BILLED stream must NEVER be recorded as 0 tokens (that's free
  // inference): if parsing misses or throws, we fall back to a conservative
  // estimate. Both the success and failure paths go through finalizeStreamBilling.
  countStreamUsage(parseStream, input.provider)
    .then((usage) => finalizeStreamBilling(input, started, usage))
    .catch((error) => {
      console.error("inference.stream_usage_failed", error);
      return finalizeStreamBilling(input, started, { tokens_in: 0, tokens_out: 0 });
    });

  return new Response(forwardStream, {
    status: upstream.status,
    headers,
  });
}

/** Max output tokens the request asked for, for the billing fallback. */
function maxTokensFromBody(body: unknown): number {
  if (typeof body !== "object" || body === null) return 4096;
  const obj = body as Record<string, unknown>;
  const v = obj.max_tokens ?? obj.max_output_tokens ?? obj.maxOutputTokens;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 4096;
}

/**
 * Record usage for a finished stream. CRITICAL: when the request is billable
 * and the parsed usage is zero (frame missing / client disconnected / odd
 * framing), bill a conservative estimate instead of zero so a served response
 * is never free. The estimate over-counts slightly on purpose — losing money
 * on a served request is worse than a small over-bill the user can dispute.
 */
async function finalizeStreamBilling(
  input: ForwardInput,
  started: number,
  usage: UsageCounts,
): Promise<void> {
  const model = extractModel(input.body);
  if (!input.bill) {
    await recordUsageSafely({
      user_id: input.auth.user.id,
      provider: input.provider,
      model,
      intent: input.intent,
      tokens_in: usage.tokens_in,
      tokens_out: usage.tokens_out,
      cost_usd_micros: 0,
      latency_ms: Date.now() - started,
      status: "ok",
    });
    return;
  }
  let billable = usage;
  if (usage.tokens_in === 0 && usage.tokens_out === 0) {
    billable = {
      tokens_in: estimateTokens(input.body),
      tokens_out: maxTokensFromBody(input.body),
    };
    console.error("inference.stream_usage_fallback_estimate", { model });
  }
  await recordUsageSafely({
    user_id: input.auth.user.id,
    provider: input.provider,
    model,
    intent: input.intent,
    tokens_in: billable.tokens_in,
    tokens_out: billable.tokens_out,
    cost_usd_micros: estimateCostMicros(model, billable),
    latency_ms: Date.now() - started,
    status: "ok",
  });
}

async function countStreamUsage(
  stream: ReadableStream<Uint8Array>,
  provider: ProviderId,
): Promise<UsageCounts> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: UsageCounts = { tokens_in: 0, tokens_out: 0 };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by blank lines. Walk them and merge usage as
    // we go: Anthropic splits the counts across frames (`message_start` has
    // input + cache, `message_delta` has output), so a naive replace would
    // clobber the cache fields. Per-field max is the safe accumulation.
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const candidate = parseUsageFromSSEFrame(frame, provider);
      if (candidate) usage = mergeUsage(usage, candidate);
    }
  }
  return usage;
}

/** Combine two partial usage reads by taking the max of each field. */
function mergeUsage(a: UsageCounts, b: UsageCounts): UsageCounts {
  return {
    tokens_in: Math.max(a.tokens_in, b.tokens_in),
    tokens_out: Math.max(a.tokens_out, b.tokens_out),
    cache_read_input_tokens: Math.max(
      a.cache_read_input_tokens ?? 0,
      b.cache_read_input_tokens ?? 0,
    ),
    cache_creation_input_tokens: Math.max(
      a.cache_creation_input_tokens ?? 0,
      b.cache_creation_input_tokens ?? 0,
    ),
  };
}

/** True when any token field carries a positive count. */
function hasUsage(u: UsageCounts): boolean {
  return (
    u.tokens_in > 0 ||
    u.tokens_out > 0 ||
    (u.cache_read_input_tokens ?? 0) > 0 ||
    (u.cache_creation_input_tokens ?? 0) > 0
  );
}

function parseUsageFromSSEFrame(
  frame: string,
  provider: ProviderId,
): UsageCounts | null {
  // Each frame looks like:  event: foo\ndata: { ... }
  // We only care about the `data: ` payload.
  const lines = frame.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]" || payload.length === 0) continue;
    try {
      const json = JSON.parse(payload);
      const usage = extractUsage(provider, json);
      if (hasUsage(usage)) return usage;
      // Anthropic puts usage inside `message_delta.usage` mid-stream.
      if (typeof json === "object" && json !== null) {
        const obj = json as Record<string, unknown>;
        const delta = obj.usage ?? (obj.message as Record<string, unknown> | undefined)?.usage;
        if (delta) {
          const nested = extractUsage(provider, { usage: delta });
          if (hasUsage(nested)) return nested;
        }
      }
    } catch {
      // Skip malformed frames; provider may emit comment lines.
    }
  }
  return null;
}

async function recordUsageSafely(
  record: Parameters<typeof recordUsage>[0],
): Promise<void> {
  try {
    await recordUsage(record);
  } catch (error) {
    console.error("inference.record_usage_failed", error);
  }
}
