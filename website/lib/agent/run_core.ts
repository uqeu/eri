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
  /** Learned writing register — how this user writes, so eri mirrors them. */
  communication_style?: string | null;
}

/** An Anthropic tool the phone turn may call (e.g. control_computer). */
export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * The tool phone eri uses to act on the user's computer: it dispatches a goal to
 * the command queue, which the computer-resident eri polls and runs through the
 * existing control stack (ADR-0002). Async — the result is texted back later.
 */
export const CONTROL_COMPUTER_TOOL: ToolDef = {
  name: "control_computer",
  description:
    "Dispatch a goal to the user's own computer to run (open/run apps, edit or read files, send things, look something up in their full memory). Use when the request needs their machine. The computer runs it and texts the result back; you won't see the outcome in this turn — just confirm you're on it.",
  input_schema: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        description: "A clear, self-contained instruction for the computer, in the user's voice.",
      },
    },
    required: ["goal"],
  },
};

/**
 * The tool phone eri uses to search the user's *deep* memory. The full memory
 * store is Tier-B — end-to-end encrypted with the user's `K_user`, which only
 * the computer holds — so the cloud literally cannot read it. This dispatches
 * the lookup to the computer-resident eri (via the same command queue as
 * control_computer); it searches the real store (hybrid + bi-temporal recall)
 * and texts the answer back. Distinct from the Tier-A profile already in the
 * prompt: use this only when the answer isn't in "what I know about you" above.
 */
export const RECALL_MEMORY_TOOL: ToolDef = {
  name: "recall_memory",
  description:
    "Look something up in the user's full private memory on their computer — for specifics you don't already know from the context above ('what did I say about X', 'when did I last…', 'what was I doing last Tuesday'). Their deep memory is end-to-end encrypted and only searchable on their machine, so this dispatches the lookup there; the computer searches and texts back what it finds. You won't see the result this turn — tell them you're checking.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What to look up, in the user's voice (e.g. 'the Henderson deal notes').",
      },
      as_of: {
        type: "string",
        description:
          "Optional time scope for what was true then ('last Tuesday', 'last month') — uses bi-temporal recall to answer about a past moment.",
      },
    },
    required: ["query"],
  },
};

/**
 * The tool eri uses to remember a durable fact the user just told it about
 * themselves — saved server-side (cloud-primary) so it's known on every future
 * text, laptop open or closed. Completes in-cloud this turn (unlike control/recall
 * which dispatch to the computer), so eri can confirm naturally in the same reply.
 */
export const REMEMBER_FACT_TOOL: ToolDef = {
  name: "remember_fact",
  description:
    "Save a durable fact or preference the user just revealed about themselves — their name, where they live, people in their life, what they're building/working on, likes/dislikes, ongoing goals, how they like things done. Use it whenever the user shares something worth knowing next time; it saves instantly to their profile and you just acknowledge naturally. Do NOT use for one-off/trivial chatter or general world facts.",
  input_schema: {
    type: "object",
    properties: {
      fact: {
        type: "string",
        description:
          "A short, self-contained statement about the user, third person (e.g. 'Lives in Toronto', 'Is building eri', 'Prefers terse, lowercase replies').",
      },
      kind: {
        type: "string",
        enum: ["fact", "preference"],
        description: "'preference' for how they like things; 'fact' otherwise.",
      },
    },
    required: ["fact"],
  },
};

/**
 * The structured payload of a `recall` command — the queue `goal` for a recall
 * turn is this JSON (not prose), so the computer's recall adapter parses it
 * deterministically rather than re-interpreting a sentence. `as_of` is carried
 * verbatim; the computer maps it onto bi-temporal `recall_as_of`.
 */
export function buildRecallPayload(query: string, asOf?: string): string {
  const scope = asOf && asOf.trim() ? asOf.trim() : undefined;
  return JSON.stringify({ query, as_of: scope });
}

export interface AgentTurnInput {
  prompt: string;
  profile?: TierAProfile | null;
  dynamicContext?: string | null;
  model?: string;
  maxTokens?: number;
  /** Tools the model may call; omit for a plain single-shot answer. */
  tools?: ToolDef[];
  /** Executes a tool the model called; returns the result text fed back. */
  onToolCall?: (name: string, input: unknown) => Promise<string>;
  /** Max model↔tool round-trips before forcing a final answer (budget guard). */
  maxHops?: number;
}

export interface AgentTurnResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

/** The model phone/proactive turns default to when the caller doesn't override. */
export const DEFAULT_MODEL = "claude-sonnet-4-6";
/**
 * The model phone *chat replies* use: Haiku is dramatically faster (lower
 * latency + TTFT) at ~90% of Sonnet's quality, which is the right trade for a
 * texting companion where speed is the felt experience. Heavier work still
 * escalates to the computer (control_computer); this is just the conversational
 * reply tier. Distinct from DEFAULT_MODEL so proactive/other callers are
 * untouched.
 */
export const PHONE_REPLY_MODEL = "claude-haiku-4-5-20251001";
/** Phone replies are short by nature; bound the turn so it fits the budget. */
const DEFAULT_MAX_TOKENS = 1024;
/** Bounded so a phone turn can't loop expensively (review H1). */
const DEFAULT_MAX_HOPS = 3;

const BASE_PERSONA = [
  "You are eri, the user's personal AI, replying over text message (iMessage).",
  "Write like a sharp, warm friend texting back — concise, plain text (no markdown, it shows as literal symbols), usually a sentence or two. Sound like a real person: contractions, lowercase is fine, match their energy. NEVER use AI-assistant tells ('Certainly!', 'I'd be happy to', 'As an AI', 'Is there anything else'), never over-explain or hedge, never narrate your own mechanics. Just talk.",
  "Mirror how the user writes (their casing, brevity, slang, emoji use) — shown in the context below. Be them's-best-friend warm, not corporate.",
  "You already know the user from the context below — use it naturally; never invent facts you weren't given. When the user tells you something durable about themselves, save it with remember_fact so you know it next time.",
  // The single most important behavior rule: answer directly. The model was
  // dispatching trivia ("what's the date") to the user's computer and failing —
  // so be explicit that tools are the exception, not the default.
  "ANSWER DIRECTLY whenever you can — the date/time (given below), general knowledge, math, advice, anything you already know or that's in your context. Most texts need NO tool; just reply. Tools are only for the two cases below.",
  "Use control_computer ONLY when the request needs an action ON their machine they can't get from you here — open/run an app, edit/read their files, send a message from their computer. It dispatches to their computer, which runs it and texts the result back; tell them you're on it, and never claim you did something you only dispatched.",
  "Use recall_memory ONLY for the user's own private history that isn't in the context above — 'what did I say about X', 'when did I last…'. Not for general facts, not for the date.",
].join(" ");

/**
 * Build the phone-eri system prompt, injecting the Tier-A profile as a fenced
 * "what I know about you" block (same shape as the IDE's context blocks). Pure +
 * unit-tested. An empty profile just omits the block. `nowText` (a preformatted
 * current-date string) is injected so eri can answer date/time questions itself
 * instead of dispatching them to the user's computer.
 */
export function buildSystemPrompt(
  profile?: TierAProfile | null,
  dynamicContext?: string | null,
  nowText?: string | null,
): string {
  const facts = profile?.facts?.filter((f) => f.trim()) ?? [];
  const prefs = profile?.preferences?.filter((p) => p.trim()) ?? [];
  const style = (profile?.communication_style ?? "").trim();
  const dynamic = (dynamicContext ?? "").trim();
  const now = (nowText ?? "").trim();

  const persona = now ? `${BASE_PERSONA}\n\nRight now it is ${now}.` : BASE_PERSONA;

  if (facts.length === 0 && prefs.length === 0 && style === "" && dynamic === "") {
    return persona;
  }

  const lines: string[] = ["```", "What I know about you:"];
  for (const f of facts) lines.push(`- ${f}`);
  for (const p of prefs) lines.push(`- ${p}`);
  if (style) lines.push(`- How you write (mirror this): ${style}`);
  if (dynamic) lines.push(`- ${dynamic}`);
  lines.push("```");

  return `${persona}\n\n${lines.join("\n")}`;
}

/**
 * Format "now" for the system prompt in a friendly, human way. Defaults to the
 * `ERI_DEFAULT_TZ` timezone (the sole user is US-Eastern today; per-user tz is a
 * known follow-up), so "what's the date" answers correctly rather than drifting a
 * day at night under UTC. Impure (reads the clock + env) — kept out of the pure
 * `buildSystemPrompt` so that stays deterministic + unit-tested.
 */
export function currentDateText(): string {
  const tz = process.env.ERI_DEFAULT_TZ || "America/New_York";
  try {
    return new Date().toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
      timeZoneName: "short",
    });
  } catch {
    return new Date().toUTCString();
  }
}

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}
interface AnthropicMessagesResponse {
  content?: ContentBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}
interface AnthropicMessage {
  role: "user" | "assistant";
  content: unknown;
}

/** The tool_use blocks the model emitted (pure — unit-tested). */
export function extractToolUses(
  content: ContentBlock[] | undefined,
): { id: string; name: string; input: unknown }[] {
  return (content ?? [])
    .filter((b) => b.type === "tool_use" && b.id && b.name)
    .map((b) => ({ id: b.id as string, name: b.name as string, input: b.input }));
}

/** Concatenate the model's text blocks into the reply (pure — unit-tested). */
export function extractText(content: ContentBlock[] | undefined): string {
  return (content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text as string)
    .join("")
    .trim();
}

/**
 * Run a bounded turn and return the final reply text. With no `tools` it's a
 * single Anthropic call; with tools it's a loop — the model may call a tool
 * (e.g. control_computer), we run it via `onToolCall`, feed the result back, and
 * continue, up to `maxHops` round-trips (review H1). Usage is summed across hops.
 * Throws on an upstream error (the caller turns it into a friendly reply).
 */
export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  const model = input.model ?? DEFAULT_MODEL;
  const system = buildSystemPrompt(input.profile, input.dynamicContext, currentDateText());
  const maxHops = input.maxHops ?? DEFAULT_MAX_HOPS;
  const messages: AnthropicMessage[] = [{ role: "user", content: input.prompt }];

  let tokensIn = 0;
  let tokensOut = 0;

  for (let hop = 0; ; hop++) {
    const body = await callAnthropic({
      model,
      maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      system,
      messages,
      tools: input.tools,
    });
    tokensIn += body.usage?.input_tokens ?? 0;
    tokensOut += body.usage?.output_tokens ?? 0;

    const toolUses = extractToolUses(body.content);
    const canCallMore = input.onToolCall && input.tools?.length && hop < maxHops;
    if (toolUses.length === 0 || !canCallMore) {
      return {
        text: extractText(body.content) || "(eri had nothing to say)",
        tokensIn,
        tokensOut,
        model,
      };
    }

    // Run each requested tool, then feed results back for the next hop.
    messages.push({ role: "assistant", content: body.content });
    const toolResults = [];
    for (const tu of toolUses) {
      const result = await input.onToolCall!(tu.name, tu.input);
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
    }
    messages.push({ role: "user", content: toolResults });
  }
}

async function callAnthropic(args: {
  model: string;
  maxTokens: number;
  system: string;
  messages: AnthropicMessage[];
  tools?: ToolDef[];
}): Promise<AnthropicMessagesResponse> {
  const payload: Record<string, unknown> = {
    model: args.model,
    max_tokens: args.maxTokens,
    // Cache the system+profile block — identical across a user's texts, so this
    // cuts per-turn input cost to ~0.1x on cache hits (review M6).
    system: [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } }],
    messages: args.messages,
  };
  if (args.tools?.length) payload.tools = args.tools;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": getMasterKey("anthropic"),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`anthropic ${response.status}: ${txt.slice(0, 200)}`);
  }
  return (await response.json()) as AnthropicMessagesResponse;
}
