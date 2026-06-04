// `POST /api/v1/agent/run` — the public agent entry point.
//
// The CLI (`eri ask "..."`), the SDKs (`@eri/sdk`, `eri-py`), and any
// third-party that holds a `eri_sk_*` bearer hit this route. It's the
// single "run my prompt through Eri" endpoint. The server picks the right
// Eri capability for the turn, then streams events back as SSE so terminals
// and scripts render progress token-by-token.
//
// Wire shape:
//   POST /api/v1/agent/run
//   Authorization: Bearer eri_sk_…
//   Body: { intent, prompt, persona?, workspaceRoot?, targets? }
//
//   ← stream of `data: { kind, text? | message?, ... }\n\n` lines
//   ← final `data: { kind: "done", tokensIn, tokensOut, engine }\n\n`
//   ← `data: [DONE]\n\n`
//
// Auth: same `authenticateApiBearer` flow the inference proxies use.
// Rate limit: same `rateLimitToken` gateway as `/inference/*` — passes
// the user's tier so the 429 envelope carries the right context.
// Quota: lightweight intents stay on the bundled path; heavier plan/ship/test
// flows count against the monthly cloud bucket.

import { authenticateApiBearer } from "@/lib/auth/api_tokens";
import { rateLimitToken } from "@/lib/inference/rate_limit";
import { ensureWithinQuota, recordUsage } from "@/lib/usage/quota";
import { featureLocked, featureLockedBody } from "@/lib/feature_gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Intent =
  | "ask"
  | "plan"
  | "ship"
  | "test"
  | "refactor"
  | "explain"
  | "sketch";

interface AgentRunBody {
  intent: Intent;
  prompt: string;
  workspaceRoot?: string;
  persona?: string;
  targets?: string[];
}

const FREE_INTENTS = new Set<Intent>(["ask", "sketch"]);

const PERSONA_DEFAULTS: Record<Intent, string> = {
  ask: "eri",
  plan: "architect",
  ship: "shipper",
  test: "tester",
  refactor: "architect",
  explain: "eri",
  sketch: "eri",
};

const ROUTING: Record<Intent, { provider: string; model: string }> = {
  ask: { provider: "anthropic", model: "claude-sonnet-4-6" },
  plan: { provider: "anthropic", model: "claude-sonnet-4-6" },
  ship: { provider: "anthropic", model: "claude-sonnet-4-6" },
  test: { provider: "anthropic", model: "claude-sonnet-4-6" },
  refactor: { provider: "anthropic", model: "claude-sonnet-4-6" },
  explain: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  sketch: { provider: "inception", model: "mercury-2" },
};

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiBearer(request.headers.get("authorization"));
  if (!auth) {
    return sseError(401, "unauthorized");
  }
  const limited = rateLimitToken(auth.apiToken.id, { tier: auth.user.tier });
  if (limited) return limited;

  let body: AgentRunBody;
  try {
    body = (await request.json()) as AgentRunBody;
  } catch {
    return sseError(400, "invalid_json");
  }
  if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return sseError(400, "missing_prompt");
  }
  const intent = (body.intent ?? "ask") as Intent;
  if (!ROUTING[intent]) {
    return sseError(400, `unknown_intent:${intent}`);
  }
  const persona = body.persona ?? PERSONA_DEFAULTS[intent];

  // Free-intent shortcut: ask / sketch stay on the bundled path and don't
  // burn frontier tokens.
  if (!FREE_INTENTS.has(intent)) {
    // Paywall: the agent intents (plan/test/refactor/explain/ship) are agent
    // mode — Pro and up. Free/Starter get a 403 with an upgrade hint.
    if (featureLocked(auth.user.tier, "agentMode")) {
      return new Response(JSON.stringify(featureLockedBody("agentMode")), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    const estimate = estimateTokens(body.prompt);
    const quota = await ensureWithinQuota(auth.user.id, auth.user.tier, estimate);
    if (!quota.ok) {
      const remaining = Math.max(
        0,
        quota.bucket.tokens_included +
          quota.bucket.tokens_overage -
          quota.bucket.tokens_used,
      );
      return new Response(
        JSON.stringify({
          error: "over_quota",
          tier: auth.user.tier,
          remaining,
        }),
        {
          status: 402,
          headers: { "content-type": "application/json" },
        },
      );
    }
  }

  const route = ROUTING[intent];
  const masterKey = pickMasterKey(route.provider);
  if (!masterKey) {
    return sseError(503, "eri_engine_unavailable");
  }

  return new Response(
    new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (obj: Record<string, unknown>): void => {
          const line = `data: ${JSON.stringify(obj)}\n\n`;
          controller.enqueue(encoder.encode(line));
        };

        try {
          send({
            kind: "tool_call",
            message: `persona=${persona} intent=${intent} engine=${publicEngine(intent)}`,
          });

          const upstream = await callUpstream({
            intent,
            prompt: body.prompt,
            persona,
            workspaceRoot: body.workspaceRoot,
            targets: body.targets ?? [],
            provider: route.provider,
            model: route.model,
            masterKey,
          });

          let tokensIn = 0;
          let tokensOut = 0;
          for await (const chunk of upstream.tokens) {
            send({ kind: "token", text: chunk.text });
            tokensIn = chunk.tokensInSoFar ?? tokensIn;
            tokensOut = chunk.tokensOutSoFar ?? tokensOut;
          }

          if (!FREE_INTENTS.has(intent)) {
            await recordUsage({
              user_id: auth.user.id,
              provider: route.provider,
              model: route.model,
              intent,
              tokens_in: tokensIn,
              tokens_out: tokensOut,
              cost_usd_micros: 0,
              latency_ms: 0,
              status: "ok",
            });
          }

          send({
            kind: "done",
            tokensIn,
            tokensOut,
            engine: publicEngine(intent),
            routedTo: publicEngine(intent),
          });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "unknown_error";
          send({ kind: "error", message });
        } finally {
          controller.close();
        }
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store, no-transform",
        "x-accel-buffering": "no",
      },
    },
  );
}

function sseError(status: number, code: string): Response {
  return new Response(
    `data: ${JSON.stringify({ kind: "error", message: code })}\n\n`,
    {
      status,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
      },
    },
  );
}

function estimateTokens(prompt: string): number {
  // ~4 chars / token rule of thumb is close enough for the quota
  // pre-flight check; the real count comes back on the recordTurn call.
  return Math.max(1, Math.ceil(prompt.length / 4));
}

function pickMasterKey(provider: string): string | undefined {
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_MASTER_KEY;
    case "openai":
      return process.env.OPENAI_MASTER_KEY;
    case "google":
      return process.env.GOOGLE_MASTER_KEY;
    case "inception":
      return process.env.INCEPTION_MASTER_KEY;
    default:
      return undefined;
  }
}

function publicEngine(intent: Intent): string {
  if (intent === "sketch") return "Eri Sketch";
  if (intent === "ship") return "Eri Shipper";
  if (intent === "test") return "Eri Tester";
  if (intent === "refactor" || intent === "plan") return "Eri Architect";
  return "Eri";
}

interface UpstreamCallArgs {
  intent: Intent;
  prompt: string;
  persona: string;
  workspaceRoot?: string;
  targets: string[];
  provider: string;
  model: string;
  masterKey: string;
}

interface TokenChunk {
  text: string;
  tokensInSoFar?: number;
  tokensOutSoFar?: number;
}

/**
 * Dispatch to the upstream capability with the persona's system prompt
 * baked in. Returns an async iterable of token chunks.
 *
 * For Anthropic we use the Messages API with streaming. For Inception
 * we use the iterate endpoint. Other providers route via OpenAI's
 * Chat Completions shape; this layer is intentionally thin since the
 * full proxy logic (`lib/inference/proxy.ts`) handles BYOK + cost
 * guard for the app-side surfaces — `/agent/run` is the simpler
 * "headless ask" path that doesn't need workspace context.
 */
async function callUpstream(args: UpstreamCallArgs): Promise<{
  tokens: AsyncIterable<TokenChunk>;
}> {
  if (args.provider === "anthropic") {
    return callAnthropic(args);
  }
  if (args.provider === "inception") {
    return callInception(args);
  }
  throw new Error(`unsupported provider: ${args.provider}`);
}

async function callAnthropic(args: UpstreamCallArgs): Promise<{
  tokens: AsyncIterable<TokenChunk>;
}> {
  const systemPrompt = personaSystem(args.persona, args.intent, args.workspaceRoot, args.targets);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": args.masterKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      max_tokens: 32000,
      stream: true,
      system: systemPrompt,
      messages: [{ role: "user", content: args.prompt }],
    }),
  });
  if (!response.ok || !response.body) {
    const txt = await response.text();
    throw new Error(
      `anthropic ${response.status}: ${txt.slice(0, 200)}`,
    );
  }
  const tokens = parseAnthropicStream(response.body);
  return { tokens };
}

async function callInception(args: UpstreamCallArgs): Promise<{
  tokens: AsyncIterable<TokenChunk>;
}> {
  // The sketch path answers as a single non-streaming call for the simple
  // "ask"/"sketch" use cases. Wrap as a degenerate async iterable.
  const response = await fetch(
    "https://api.inceptionlabs.ai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.masterKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: args.model,
        messages: [
          {
            role: "system",
            content: personaSystem(args.persona, args.intent, args.workspaceRoot, args.targets),
          },
          { role: "user", content: args.prompt },
        ],
      }),
    },
  );
  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`inception ${response.status}: ${txt.slice(0, 200)}`);
  }
  const body = await response.json();
  const content: string =
    body?.choices?.[0]?.message?.content ?? "(no content)";
  const usage = body?.usage ?? {};
  const tokens: TokenChunk[] = [
    {
      text: content,
      tokensInSoFar: usage.prompt_tokens ?? 0,
      tokensOutSoFar: usage.completion_tokens ?? 0,
    },
  ];
  return {
    tokens: (async function* () {
      for (const t of tokens) yield t;
    })(),
  };
}

async function* parseAnthropicStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<TokenChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let tokensIn = 0;
  let tokensOut = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let lineBreak: number;
    while ((lineBreak = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, lineBreak);
      buffer = buffer.slice(lineBreak + 2);
      for (const line of block.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as {
            type?: string;
            delta?: { text?: string; type?: string };
            message?: { usage?: { input_tokens?: number; output_tokens?: number } };
            usage?: { input_tokens?: number; output_tokens?: number };
          };
          if (
            parsed.type === "content_block_delta" &&
            parsed.delta?.type === "text_delta" &&
            typeof parsed.delta.text === "string"
          ) {
            yield {
              text: parsed.delta.text,
              tokensInSoFar: tokensIn,
              tokensOutSoFar: tokensOut,
            };
          }
          if (parsed.message?.usage) {
            tokensIn = parsed.message.usage.input_tokens ?? tokensIn;
            tokensOut = parsed.message.usage.output_tokens ?? tokensOut;
          }
          if (parsed.usage) {
            tokensIn = parsed.usage.input_tokens ?? tokensIn;
            tokensOut = parsed.usage.output_tokens ?? tokensOut;
          }
        } catch {
          // forward-compat: ignore unparseable events.
        }
      }
    }
  }
}

function personaSystem(
  persona: string,
  intent: Intent,
  workspaceRoot: string | undefined,
  targets: string[],
): string {
  const lines: string[] = [];
  lines.push(`You are eri, an agentic AI assistant. Persona: ${persona}.`);
  switch (intent) {
    case "plan":
      lines.push("Produce a step-by-step plan in Markdown. Each step is concrete + verifiable.");
      break;
    case "ship":
      lines.push(
        "Output ONE complete, self-contained HTML5 document and NOTHING else — no prose, no explanation, no markdown code fences, no tool calls. Begin at <!DOCTYPE html> and end at </html>.",
        "Put ALL CSS in a single <style> in the <head> and ALL JS in one <script> before </body>. Reference NO external files (no styles.css, no external JS). System font stack unless a brand font via Google Fonts <link> is clearly warranted.",
        "Use straight ASCII punctuation (', \", -, ...) — never smart quotes, em dashes, or special glyphs — and include <meta charset=\"utf-8\"> so encoding is never ambiguous.",
        "Design bar = v0/Lovable quality: one accent color, a real type scale, generous spacing on a 4/8px grid, depth from subtle borders not heavy shadows, fully responsive (375px and 1440px), accessible (semantic tags, focus states, alt text, >=4.5:1 contrast), and REAL specific copy — never lorem ipsum or 'Feature 1/2/3'. It must render beautifully as a single file opened directly in a browser.",
      );
      break;
    case "test":
      lines.push("Generate tests with assertions that fail meaningfully when broken.");
      break;
    case "refactor":
      lines.push("Suggest a refactor; show before / after as diff fences. Preserve public APIs.");
      break;
    case "explain":
      lines.push("Explain the target in plain language. Include design intent + edge cases.");
      break;
    case "sketch":
      lines.push("Draft a self-contained HTML page that matches the description.");
      break;
    case "ask":
    default:
      lines.push("Answer concisely. Cite code paths when relevant.");
      break;
  }
  if (workspaceRoot) {
    lines.push(`Workspace root: ${workspaceRoot}.`);
  }
  if (targets.length > 0) {
    lines.push(`Targets: ${targets.join(", ")}.`);
  }
  return lines.join("\n");
}
