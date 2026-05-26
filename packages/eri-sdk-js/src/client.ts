import {
  AgentEvent,
  AgentRunOptions,
  EriError,
  EriOptions,
  Observation,
  RecallResult,
  UsageSummary,
} from "./types.js";

const DEFAULT_BASE_URL = "https://tryeri.ca";
const SDK_VERSION = "0.1.0";

/**
 * Main SDK entry point.
 *
 * ```ts
 * import { Eri } from "@eri/sdk";
 *
 * const eri = new Eri({ apiKey: process.env.ERI_API_KEY });
 *
 * // One-shot answer.
 * const answer = await eri.ask("what is tokio's runtime model?");
 * console.log(answer);
 *
 * // Streaming.
 * for await (const event of eri.stream({ intent: "plan", prompt: "add Stripe checkout" })) {
 *   if (event.kind === "token") process.stdout.write(event.text);
 * }
 * ```
 */
export class Eri {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  public readonly memory: Memory;

  constructor(options: EriOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ERI_API_KEY;
    if (!apiKey) {
      throw new EriError(
        "missing apiKey — pass `{ apiKey }` or set ERI_API_KEY",
        400,
        "missing_api_key",
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = trimSlash(
      options.baseUrl ?? process.env.ERI_BASE_URL ?? DEFAULT_BASE_URL,
    );
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.userAgent = options.userAgent ?? `@eri/sdk/${SDK_VERSION}`;
    this.memory = new Memory(this);
  }

  /** Buffer the streamed response into a single string. */
  async ask(prompt: string, opts: Partial<AgentRunOptions> = {}): Promise<string> {
    return this.runBuffered({ ...opts, intent: "ask", prompt });
  }

  async plan(prompt: string, opts: Partial<AgentRunOptions> = {}): Promise<string> {
    return this.runBuffered({ ...opts, intent: "plan", prompt });
  }

  async ship(prompt: string, opts: Partial<AgentRunOptions> = {}): Promise<string> {
    return this.runBuffered({ ...opts, intent: "ship", prompt });
  }

  async test(scope: string, opts: Partial<AgentRunOptions> = {}): Promise<string> {
    return this.runBuffered({
      ...opts,
      intent: "test",
      prompt: scope || "Add tests where missing.",
      targets: scope ? [scope] : undefined,
    });
  }

  async refactor(scope: string, opts: Partial<AgentRunOptions> = {}): Promise<string> {
    return this.runBuffered({
      ...opts,
      intent: "refactor",
      prompt: scope || "Suggest a refactor.",
      targets: scope ? [scope] : undefined,
    });
  }

  async explain(target: string, opts: Partial<AgentRunOptions> = {}): Promise<string> {
    return this.runBuffered({
      ...opts,
      intent: "explain",
      prompt: `Explain ${target}.`,
      targets: [target],
    });
  }

  async sketch(prompt: string, opts: Partial<AgentRunOptions> = {}): Promise<string> {
    return this.runBuffered({ ...opts, intent: "sketch", prompt });
  }

  /**
   * Stream raw events. Use this when you want to render tokens
   * progressively (a terminal cursor, a chat UI). Iterates exactly
   * once; awaiting after completion returns nothing.
   */
  async *stream(opts: AgentRunOptions): AsyncIterable<AgentEvent> {
    const response = await this.postStream(opts);
    yield* parseSseStream(response, opts.signal);
  }

  /** Live usage summary for the signed-in user. */
  async usage(): Promise<UsageSummary> {
    return this.requestJson<UsageSummary>("GET", "/api/v1/usage");
  }

  private async runBuffered(opts: AgentRunOptions): Promise<string> {
    let out = "";
    for await (const event of this.stream(opts)) {
      if (event.kind === "token") out += event.text;
      if (event.kind === "error") {
        throw new EriError(event.message, 500, "agent_error");
      }
    }
    return out;
  }

  /** @internal */ async postStream(opts: AgentRunOptions): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const signal = mergeSignals(controller.signal, opts.signal);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/v1/agent/run`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "User-Agent": this.userAgent,
        },
        body: JSON.stringify({
          intent: opts.intent,
          prompt: opts.prompt,
          workspaceRoot: opts.workspaceRoot,
          persona: opts.persona,
          targets: opts.targets,
        }),
        signal,
      });
      if (!response.ok) {
        await throwForResponse(response);
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** @internal */ async requestJson<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": this.userAgent,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        await throwForResponse(response);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

class Memory {
  constructor(private readonly eri: Eri) {}

  async recall(query: string, limit = 20): Promise<Observation[]> {
    const { results } = await this.eri.requestJson<RecallResult>(
      "POST",
      "/api/v1/memory/recall",
      { query, limit },
    );
    return results;
  }

  async remember(text: string): Promise<{ id: string }> {
    return this.eri.requestJson<{ id: string }>(
      "POST",
      "/api/v1/memory/remember",
      { text },
    );
  }

  async forget(target: string): Promise<{ removed: number }> {
    return this.eri.requestJson<{ removed: number }>(
      "POST",
      "/api/v1/memory/forget",
      { target },
    );
  }
}

function trimSlash(s: string): string {
  let out = s;
  while (out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

async function throwForResponse(response: Response): Promise<never> {
  let payload: unknown;
  let code: string | undefined;
  try {
    payload = await response.json();
    if (typeof (payload as { error?: string })?.error === "string") {
      code = (payload as { error: string }).error;
    }
  } catch {
    // body wasn't JSON; ignore.
  }
  throw new EriError(
    `HTTP ${response.status}: ${code ?? response.statusText}`,
    response.status,
    code,
    payload,
  );
}

function mergeSignals(a: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!b) return a;
  // Node 20+ supports AbortSignal.any; fall back to a manual merge otherwise.
  const anyFn = (AbortSignal as unknown as { any?: (sigs: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") {
    return anyFn([a, b]);
  }
  const c = new AbortController();
  const abort = (): void => c.abort();
  a.addEventListener("abort", abort, { once: true });
  b.addEventListener("abort", abort, { once: true });
  return c.signal;
}

async function* parseSseStream(
  response: Response,
  signal: AbortSignal | undefined,
): AsyncIterable<AgentEvent> {
  if (!response.body) {
    throw new EriError("response body missing", 500, "no_body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) break;
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
            yield JSON.parse(payload) as AgentEvent;
          } catch {
            // Forward-compat: ignore unparseable events.
          }
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}
