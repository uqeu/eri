/**
 * run_core — the shared, non-streaming agent turn (Phase 1, ADR-0002).
 *
 * Phone eri can't stream SSE back over iMessage and must fit the Vercel function
 * budget, so it needs a *bounded, single-shot* "run this prompt and give me the
 * full text" call — distinct from `/api/v1/agent/run`'s streaming path. This is
 * that core: build the system prompt (with the Tier-A personalization profile
 * injected as a fenced "what I know about you" block) and do one Anthropic
 * Messages call. The pure `buildSystemPrompt` is the unit-tested part; the fetch
 * is the same thin, integration-tested-later shape the routes use.
 */

import { getMasterKey } from "@/lib/inference/providers";

/** The server-readable Tier-A profile shape (mirrors the Rust `Profile`). */
export interface TierAProfile {
  facts?: string[];
  preferences?: string[];
}

export interface AgentTurnInput {
  prompt: string;
  profile?: TierAProfile | null;
  dynamicContext?: string | null;
  model?: string;
  maxTokens?: number;
}

export interface AgentTurnResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

const DEFAULT_MODEL = "claude-sonnet-4-6";
/** Phone replies are short by nature; bound the turn so it fits the budget. */
const DEFAULT_MAX_TOKENS = 1024;

const BASE_PERSONA = [
  "You are eri, the user's personal AI, replying over text message (iMessage).",
  "Write like a sharp, warm friend: concise, plain text (no markdown — it shows as literal symbols), a few sentences at most unless asked for more.",
  "You already know the user from the context below — use it naturally; never invent facts you weren't given.",
  "If a request needs their computer (running code, opening apps, files), say you'll need their computer for that — don't pretend you did it.",
].join(" ");

/**
 * Build the phone-eri system prompt, injecting the Tier-A profile as a fenced
 * "what I know about you" block (same shape as the IDE's context blocks). Pure +
 * unit-tested. An empty profile just omits the block.
 */
export function buildSystemPrompt(
  profile?: TierAProfile | null,
  dynamicContext?: string | null,
): string {
  const facts = profile?.facts?.filter((f) => f.trim()) ?? [];
  const prefs = profile?.preferences?.filter((p) => p.trim()) ?? [];
  const dynamic = (dynamicContext ?? "").trim();

  if (facts.length === 0 && prefs.length === 0 && dynamic === "") {
    return BASE_PERSONA;
  }

  const lines: string[] = ["```", "What I know about you:"];
  for (const f of facts) lines.push(`- ${f}`);
  for (const p of prefs) lines.push(`- ${p}`);
  if (dynamic) lines.push(`- ${dynamic}`);
  lines.push("```");

  return `${BASE_PERSONA}\n\n${lines.join("\n")}`;
}

interface AnthropicMessagesResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Run one bounded turn and return the full reply text. Single-shot, non-stream.
 * Throws on an upstream error (the caller maps it to a friendly text + 200 so
 * the webhook doesn't get retried into a loop).
 */
export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  const model = input.model ?? DEFAULT_MODEL;
  const system = buildSystemPrompt(input.profile, input.dynamicContext);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": getMasterKey("anthropic"),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      system,
      messages: [{ role: "user", content: input.prompt }],
    }),
  });
  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`anthropic ${response.status}: ${txt.slice(0, 200)}`);
  }
  const body = (await response.json()) as AnthropicMessagesResponse;
  const text = (body.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text as string)
    .join("")
    .trim();
  return {
    text: text || "(eri had nothing to say)",
    tokensIn: body.usage?.input_tokens ?? 0,
    tokensOut: body.usage?.output_tokens ?? 0,
    model,
  };
}
