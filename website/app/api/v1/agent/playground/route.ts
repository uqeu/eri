// `/api/v1/agent/playground` — anonymous, IP-rate-limited demo of
// Eri. Distinct from `/api/v1/agent/run` because it doesn't
// require a bearer token. Caps per IP at 10 turns / hour to keep
// abuse bounded; longer or more demanding prompts hit the standard
// `over_quota` path the app/CLI already understand.
//
// The playground shows public Eri routes only; provider details stay behind
// the server.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Intent = "ask" | "plan" | "sketch";

const FREE_LIMIT_PER_HOUR = 10;
const IP_BUCKETS = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown";
}

function checkRate(ip: string): { ok: true } | { ok: false; resetAt: number } {
  const now = Date.now();
  const bucket = IP_BUCKETS.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    IP_BUCKETS.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return { ok: true };
  }
  if (bucket.count >= FREE_LIMIT_PER_HOUR) {
    return { ok: false, resetAt: bucket.resetAt };
  }
  bucket.count += 1;
  return { ok: true };
}

function sseError(status: number, message: string): Response {
  return new Response(
    `data: ${JSON.stringify({ kind: "error", message })}\n\n`,
    {
      status,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
      },
    },
  );
}

export async function POST(request: Request): Promise<Response> {
  const ip = clientIp(request);
  const rate = checkRate(ip);
  if (!rate.ok) {
    return sseError(429, "rate_limited");
  }
  let body: { intent?: Intent; prompt?: string };
  try {
    body = await request.json();
  } catch {
    return sseError(400, "invalid_json");
  }
  const intent = (body.intent ?? "ask") as Intent;
  if (intent !== "ask" && intent !== "plan" && intent !== "sketch") {
    return sseError(400, "unknown_intent");
  }
  const prompt = (body.prompt ?? "").trim();
  if (!prompt || prompt.length > 4_000) {
    return sseError(400, "prompt_required_or_too_long");
  }

  const masterKey = process.env.ANTHROPIC_MASTER_KEY;
  if (intent !== "sketch" && !masterKey) {
    return sseError(503, "eri_engine_unavailable");
  }
  if (intent === "sketch" && !process.env.INCEPTION_MASTER_KEY) {
    return sseError(503, "eri_engine_unavailable");
  }

  return new Response(
    new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (obj: Record<string, unknown>): void => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        };
        try {
          if (intent === "sketch") {
            await streamInception(prompt, send);
          } else {
            await streamHaiku(prompt, intent, send, masterKey!);
          }
          send({ kind: "done" });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          send({
            kind: "error",
            message: err instanceof Error ? err.message : "unknown",
          });
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

async function streamHaiku(
  prompt: string,
  intent: "ask" | "plan",
  send: (event: Record<string, unknown>) => void,
  apiKey: string,
): Promise<void> {
  const systemPrompt =
    intent === "plan"
      ? "Produce a step-by-step plan in Markdown. Each step is concrete and verifiable."
      : "Answer the question concisely. Cite docs / RFCs when relevant.";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      stream: true,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Eri Cloud ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
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
          };
          if (
            parsed.type === "content_block_delta" &&
            parsed.delta?.type === "text_delta" &&
            typeof parsed.delta.text === "string"
          ) {
            send({ kind: "token", text: parsed.delta.text });
          }
        } catch {
          // ignore unparseable
        }
      }
    }
  }
}

async function streamInception(
  prompt: string,
  send: (event: Record<string, unknown>) => void,
): Promise<void> {
  const response = await fetch("https://api.inceptionlabs.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.INCEPTION_MASTER_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "mercury-2",
      messages: [
        {
          role: "system",
          content:
            "Draft a self-contained HTML page that matches the description. No external assets.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Eri Cloud ${response.status}`);
  }
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  // Stream the content in chunks so the UI feels alive.
  const chunkSize = 32;
  for (let i = 0; i < content.length; i += chunkSize) {
    send({ kind: "token", text: content.slice(i, i + chunkSize) });
  }
}
