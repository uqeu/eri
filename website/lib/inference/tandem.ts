/**
 * Builder/Checker tandem orchestration for `/api/v1/inference/ship`.
 *
 *   ┌─────────┐   ┌─────────┐
 *   │ Sonnet  │   │ GPT-4o  │   ← builders run in parallel (Promise.allSettled)
 *   └────┬────┘   └────┬────┘
 *        └────┬────────┘
 *             ▼
 *        ┌─────────┐
 *        │ Gemini  │             ← checker reads both, emits ONE merged patchset
 *        └────┬────┘
 *             ▼
 *      search/replace blocks → ApplyOrchestrator
 *
 * The builders both get the SAME brief — diversity over consensus. The
 * checker validates and merges; this is the agentic "two paths, one truth"
 * pattern. Survives single-model outage: if a builder fails, the survivor's
 * output alone goes to the checker.
 *
 * Model IDs are pinned to what `lib/inference/providers.ts` +
 * `crates/eri_inference/src/llm_provider.rs` actually accept today. When
 * the registry adds `gpt-5` / `gemini-2.5-pro`, swap `DEFAULT_PLAN`.
 */

import { checkModelAllowed } from "./cost_guard";
import { extractUsage, estimateCostMicros, type UsageCounts } from "./tokens";
import {
  getMasterKey,
  MissingMasterKeyError,
  providerConfig,
  type ProviderId,
} from "./providers";

export type TandemRole = "builder" | "checker";

export interface TandemSlot {
  role: TandemRole;
  provider: ProviderId;
  model: string;
}

export interface BuilderCheckerPlan {
  builders: TandemSlot[];
  checker: TandemSlot;
}

export const DEFAULT_PLAN: BuilderCheckerPlan = {
  builders: [
    {
      role: "builder",
      provider: "anthropic",
      model: "claude-sonnet-4-5-20251015",
    },
    {
      role: "builder",
      provider: "openai",
      model: "gpt-4o",
    },
  ],
  checker: {
    role: "checker",
    provider: "google",
    model: "gemini-2.0-flash-thinking-exp",
  },
};

export interface WorkspaceFile {
  path: string;
  content: string;
}

export interface RunTandemInput {
  instructions: string;
  workspaceFiles: WorkspaceFile[];
  plan?: BuilderCheckerPlan;
  /**
   * Optional BYOK overrides keyed by ProviderId. When supplied, the tandem
   * uses these in place of the master keys for that provider's slot. The
   * caller (route.ts) decides whether to populate this from BYOK headers.
   */
  byokKeys?: Partial<Record<ProviderId, string>>;
}

export type TandemEvent =
  | { kind: "builder_started"; model: string; provider: ProviderId }
  | { kind: "builder_done"; model: string; provider: ProviderId; tokens: UsageCounts; cost_usd_micros: number; text: string }
  | { kind: "builder_failed"; model: string; provider: ProviderId; reason: string }
  | { kind: "checker_started"; model: string; provider: ProviderId }
  | { kind: "checker_token"; text: string }
  | { kind: "checker_done"; model: string; provider: ProviderId; tokens: UsageCounts; cost_usd_micros: number; text: string }
  | { kind: "ship_done"; totals: { tokens_in: number; tokens_out: number; cost_usd_micros: number }; survivors: string[] }
  | { kind: "ship_failed"; reason: string };

interface BuilderResult {
  slot: TandemSlot;
  text: string;
  tokens: UsageCounts;
  costMicros: number;
}

/**
 * Common builder brief: aider-style search/replace blocks, one per file.
 * Identical prompt for both builders — divergence comes from the models,
 * not the brief. Keep it terse so the checker has room to reason.
 */
export function buildBuilderPrompt(
  instructions: string,
  files: WorkspaceFile[],
): string {
  const fileSection = files
    .map((f) => `<file path="${f.path}">\n${f.content}\n</file>`)
    .join("\n\n");
  return [
    "You are one of two parallel builders shipping a production-ready change for a user of the eri agentic IDE.",
    "Output ONLY aider-style search/replace blocks. No explanation, no preamble.",
    "Each block: a fenced search section that exactly matches the existing file, followed by a fenced replace section.",
    "Format per block:",
    "  <<<<<<< SEARCH",
    "  …existing text…",
    "  =======",
    "  …new text…",
    "  >>>>>>> REPLACE path=<relative/path>",
    "",
    "## User intent",
    instructions,
    "",
    "## Files in scope",
    fileSection,
  ].join("\n");
}

/**
 * Checker reads both builder outputs and emits ONE merged patchset. Cites
 * which builder each edit came from via `// from: <name>` comments so the
 * UI can show provenance per applied edit.
 */
export function buildCheckerPrompt(
  instructions: string,
  builderOutputs: { model: string; text: string }[],
): string {
  const builderSections = builderOutputs
    .map(
      (b) =>
        `<builder name="${b.model}">\n${b.text}\n</builder>`,
    )
    .join("\n\n");
  return [
    "You are the checker in eri's builder/checker ship pipeline. Two builders independently produced search/replace patchsets for the same user intent. Your job: emit ONE merged, validated, production-ready patchset.",
    "Rules:",
    "  1. Pick the better edit per file. When both are roughly equivalent, prefer the more idiomatic one.",
    "  2. If both miss something the user asked for, write the missing edit yourself and tag it `// from: checker`.",
    "  3. If a builder edit looks wrong (broken regex, dangling state, syntax errors), REJECT it.",
    "  4. Output ONLY merged search/replace blocks in the same aider format as the builders.",
    "  5. Above each block, add a single-line comment: `// from: <builder-name | checker>`.",
    "",
    "## User intent",
    instructions,
    "",
    "## Builder outputs",
    builderSections,
  ].join("\n");
}

/**
 * Run one model end-to-end (non-streaming for builders, streaming for the
 * checker). Returns the full text + token counts when done. Throws when
 * the master key is missing OR upstream returns non-200 — caller catches
 * and emits builder_failed / ship_failed.
 */
async function forwardOne(
  slot: TandemSlot,
  prompt: string,
  apiKey: string,
  onToken?: (text: string) => void,
): Promise<{ text: string; tokens: UsageCounts; costMicros: number }> {
  const config = providerConfig(slot.provider);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...config.authHeader(apiKey),
  };

  // Per-provider body shape — kept inline rather than templated because
  // each provider's request format diverges enough that abstraction would
  // hide bugs.
  let url: string;
  let body: unknown;
  if (slot.provider === "anthropic") {
    url = config.defaultUrl;
    body = {
      model: slot.model,
      max_tokens: 4096,
      stream: Boolean(onToken),
      messages: [{ role: "user", content: prompt }],
    };
  } else if (slot.provider === "openai") {
    url = config.defaultUrl;
    body = {
      model: slot.model,
      stream: Boolean(onToken),
      messages: [{ role: "user", content: prompt }],
    };
  } else if (slot.provider === "google") {
    url = `${config.defaultUrl}/${encodeURIComponent(slot.model)}:${onToken ? "streamGenerateContent" : "generateContent"}`;
    body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    };
  } else {
    throw new Error(`tandem: unsupported provider ${slot.provider}`);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `upstream_${response.status}: ${await response.text().catch(() => "")}`,
    );
  }

  if (!onToken) {
    const json = await response.json();
    const text = extractText(slot.provider, json);
    const tokens = extractUsage(slot.provider, json);
    return {
      text,
      tokens,
      costMicros: estimateCostMicros(slot.model, tokens),
    };
  }

  // Streaming path — accumulate text, fire callback per delta.
  if (!response.body) {
    throw new Error("upstream_empty");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let tokens: UsageCounts = { tokens_in: 0, tokens_out: 0 };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const delta = parseStreamFrame(slot.provider, frame);
      if (delta.text) {
        fullText += delta.text;
        onToken(delta.text);
      }
      if (delta.tokens) tokens = delta.tokens;
    }
  }
  return {
    text: fullText,
    tokens,
    costMicros: estimateCostMicros(slot.model, tokens),
  };
}

function extractText(provider: ProviderId, json: unknown): string {
  if (typeof json !== "object" || json === null) return "";
  const obj = json as Record<string, unknown>;
  if (provider === "anthropic") {
    const content = obj.content;
    if (!Array.isArray(content)) return "";
    return content
      .map((part) =>
        typeof part === "object" && part !== null && "text" in part
          ? String((part as Record<string, unknown>).text ?? "")
          : "",
      )
      .join("");
  }
  if (provider === "openai" || provider === "inception") {
    const choices = obj.choices;
    if (!Array.isArray(choices) || choices.length === 0) return "";
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    return typeof message?.content === "string" ? message.content : "";
  }
  if (provider === "google") {
    const candidates = obj.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return "";
    const first = candidates[0] as Record<string, unknown> | undefined;
    const content = first?.content as Record<string, unknown> | undefined;
    const parts = content?.parts;
    if (!Array.isArray(parts)) return "";
    return parts
      .map((p) =>
        typeof p === "object" && p !== null && "text" in p
          ? String((p as Record<string, unknown>).text ?? "")
          : "",
      )
      .join("");
  }
  return "";
}

function parseStreamFrame(
  provider: ProviderId,
  frame: string,
): { text: string; tokens?: UsageCounts } {
  // Each provider's SSE format differs slightly. We extract the per-delta
  // text and, if present, the trailing usage counts. Caller folds them in.
  for (const line of frame.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]" || payload.length === 0) continue;
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      continue;
    }
    if (typeof json !== "object" || json === null) continue;
    const obj = json as Record<string, unknown>;
    if (provider === "anthropic") {
      const type = obj.type;
      if (type === "content_block_delta") {
        const delta = obj.delta as Record<string, unknown> | undefined;
        if (delta && typeof delta.text === "string") {
          return { text: delta.text };
        }
      }
      if (type === "message_delta" && obj.usage) {
        return {
          text: "",
          tokens: extractUsage(provider, { usage: obj.usage }),
        };
      }
    } else if (provider === "openai" || provider === "inception") {
      const choices = obj.choices;
      if (Array.isArray(choices) && choices.length > 0) {
        const first = choices[0] as Record<string, unknown> | undefined;
        const delta = first?.delta as Record<string, unknown> | undefined;
        if (typeof delta?.content === "string") {
          return { text: delta.content };
        }
      }
      if (obj.usage) {
        return { text: "", tokens: extractUsage(provider, obj) };
      }
    } else if (provider === "google") {
      const candidates = obj.candidates;
      if (Array.isArray(candidates) && candidates.length > 0) {
        const first = candidates[0] as Record<string, unknown> | undefined;
        const content = first?.content as Record<string, unknown> | undefined;
        const parts = content?.parts;
        if (Array.isArray(parts)) {
          const text = parts
            .map((p) =>
              typeof p === "object" && p !== null && "text" in p
                ? String((p as Record<string, unknown>).text ?? "")
                : "",
            )
            .join("");
          if (text) return { text };
        }
      }
      if (obj.usageMetadata) {
        return { text: "", tokens: extractUsage(provider, obj) };
      }
    }
  }
  return { text: "" };
}

function resolveKey(
  provider: ProviderId,
  byokKeys?: Partial<Record<ProviderId, string>>,
): string {
  if (byokKeys && byokKeys[provider]) {
    return byokKeys[provider] as string;
  }
  return getMasterKey(provider); // throws MissingMasterKeyError when unset
}

/**
 * Main orchestrator. Yields `TandemEvent`s in the order they happen. The
 * route wraps this iterator in an SSE stream. Failures are non-fatal as
 * long as at least one builder succeeds; both failing yields `ship_failed`.
 */
export async function* runTandem(
  input: RunTandemInput,
): AsyncGenerator<TandemEvent> {
  const plan = input.plan ?? DEFAULT_PLAN;
  const builderPrompt = buildBuilderPrompt(input.instructions, input.workspaceFiles);

  // Cost guard: refuse to dispatch Opus / o1 / gpt-5-pro through eri's
  // master keys. Caller can bypass by switching to BYOK. Reject up-front
  // so a tandem with one bad slot doesn't waste the survivors' tokens.
  if (!input.byokKeys) {
    for (const slot of [...plan.builders, plan.checker]) {
      const guard = checkModelAllowed(slot.model);
      if (!guard.allowed) {
        yield {
          kind: "ship_failed",
          reason: `model_not_allowed:${slot.model} (${guard.reason}); suggested=${guard.suggested}`,
        };
        return;
      }
    }
  }

  // Phase 1: both builders in parallel. Non-streaming for builders keeps
  // the UI simple — we show "running" → "done" with token counts. Streaming
  // the checker is the bigger UX payoff and that's where we focus tokens.
  for (const slot of plan.builders) {
    yield { kind: "builder_started", model: slot.model, provider: slot.provider };
  }

  const builderPromises = plan.builders.map(async (slot) => {
    try {
      const key = resolveKey(slot.provider, input.byokKeys);
      const result = await forwardOne(slot, builderPrompt, key);
      return { slot, ...result } as BuilderResult;
    } catch (error) {
      const reason =
        error instanceof MissingMasterKeyError
          ? "provider_unavailable"
          : error instanceof Error
            ? error.message
            : "unknown_error";
      return { slot, reason } as { slot: TandemSlot; reason: string };
    }
  });

  const settled = await Promise.all(builderPromises);
  const survivors: BuilderResult[] = [];
  for (const r of settled) {
    if ("text" in r) {
      yield {
        kind: "builder_done",
        model: r.slot.model,
        provider: r.slot.provider,
        tokens: r.tokens,
        cost_usd_micros: r.costMicros,
        text: r.text,
      };
      survivors.push(r);
    } else {
      yield {
        kind: "builder_failed",
        model: r.slot.model,
        provider: r.slot.provider,
        reason: r.reason,
      };
    }
  }

  if (survivors.length === 0) {
    yield { kind: "ship_failed", reason: "all_builders_failed" };
    return;
  }

  // Phase 2: checker reads survivor outputs, streams the merged patchset.
  const checkerPrompt = buildCheckerPrompt(
    input.instructions,
    survivors.map((s) => ({ model: s.slot.model, text: s.text })),
  );

  yield { kind: "checker_started", model: plan.checker.model, provider: plan.checker.provider };

  let checkerResult: { text: string; tokens: UsageCounts; costMicros: number };
  try {
    const key = resolveKey(plan.checker.provider, input.byokKeys);
    const buffer: string[] = [];
    checkerResult = await forwardOne(
      plan.checker,
      checkerPrompt,
      key,
      (delta) => buffer.push(delta),
    );
    // Yield collected tokens as a single event after the streaming finishes —
    // the route's SSE pipe will actually emit per-token events as they're
    // produced via the streaming forwarder once we move to async iterators.
    // For now we batch; the route file can split this into chunks if needed.
    for (const t of buffer) {
      yield { kind: "checker_token", text: t };
    }
  } catch (error) {
    const reason =
      error instanceof MissingMasterKeyError
        ? "checker_provider_unavailable"
        : error instanceof Error
          ? error.message
          : "unknown_error";
    yield { kind: "ship_failed", reason: `checker_failed: ${reason}` };
    return;
  }

  yield {
    kind: "checker_done",
    model: plan.checker.model,
    provider: plan.checker.provider,
    tokens: checkerResult.tokens,
    cost_usd_micros: checkerResult.costMicros,
    text: checkerResult.text,
  };

  const totalIn = survivors.reduce((s, r) => s + r.tokens.tokens_in, 0) + checkerResult.tokens.tokens_in;
  const totalOut = survivors.reduce((s, r) => s + r.tokens.tokens_out, 0) + checkerResult.tokens.tokens_out;
  const totalCost = survivors.reduce((s, r) => s + r.costMicros, 0) + checkerResult.costMicros;

  yield {
    kind: "ship_done",
    totals: { tokens_in: totalIn, tokens_out: totalOut, cost_usd_micros: totalCost },
    survivors: survivors.map((s) => s.slot.model),
  };
}
