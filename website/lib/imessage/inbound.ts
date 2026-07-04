/**
 * Inbound orchestrator for phone eri (Phase 1 review H2).
 *
 * The webhook route was a god-function doing verify → parse → dedup → pair →
 * resolve → gate → quota → profile → turn → meter → send in one place, with
 * seven ad-hoc return shapes and no tests. This extracts the *decision* — given
 * a parsed message, what should we reply and what should we meter — behind an
 * injected-dependency seam, so the branch logic is unit-tested without a DB or
 * the model. The route keeps only transport: verify, lease, call this, meter,
 * send, log.
 */

import {
  CONTROL_COMPUTER_TOOL,
  DEFAULT_MODEL,
  PHONE_REPLY_MODEL,
  RECALL_MEMORY_TOOL,
  REMEMBER_FACT_TOOL,
  buildRecallPayload,
  buildSystemPrompt,
  currentDateText,
  type ConversationTurn,
  type TierAProfile,
  type ToolDef,
} from "@/lib/agent/run_core";
import {
  CHECK_CALENDAR_TOOL,
  CHECK_EMAIL_TOOL,
  formatEmails,
  formatEvents,
  readRecentEmails,
  readUpcomingEvents,
  type ConnectorDeps,
} from "@/lib/agent/connectors";
import {
  WEB_SEARCH_TOOL,
  formatResults,
  webSearch,
  type WebSearchDeps,
} from "@/lib/agent/web_search";
import {
  WEATHER_TOOL,
  formatWeather,
  getWeather,
  type WeatherDeps,
} from "@/lib/agent/weather";
import type { CommandKind } from "@/lib/commands/queue";
import { featureLocked } from "@/lib/feature_gate";
import { isAffirmation, isCorrection, isNegation } from "@/lib/imessage/affirm";
import { classifyCodingIntent, type CodingIntent } from "@/lib/coding/intent";
import { formatReply } from "@/lib/imessage/format";
import { splitIntoBubbles } from "@/lib/messaging/bubbles";
import { extractPairingCode } from "@/lib/imessage/identity";
import type { InboundMessage } from "@/lib/imessage/webhook";

export const REPLY = {
  notLinked:
    "Hey! I don't recognize this number yet 🌿 Run `eri phone link` on your computer and text me the code it gives you to connect.",
  welcomeNew:
    "hey, i'm eri 🌿 i don't know you yet, tap here to set yourself up, and i'll be linked to this number:",
  linked: 'You\'re linked! 🌿 Text me anything, I know your day. Try "what was I working on?"',
  locked: "Texting with eri is a Pro+ feature, upgrade at tryeri.ca to chat with me here.",
  overQuota:
    "You're out of eri credits for this cycle, they reset next period, or upgrade at tryeri.ca.",
  errored: "Sorry, I hit a snag answering that. Try me again in a sec 🌿",
  confirmed: "On it, I'll text you the moment it's done. 🌿",
  cancelled: "Okay, I'll leave that one. 🌿",
} as const;

/** A usage row to write (only for turns that actually called the model). */
export interface InboundMeter {
  userId: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  status: "ok" | "error";
}

export type InboundBranch =
  | "paired"
  | "not_linked"
  | "locked"
  | "confirmed"
  | "cancelled"
  | "over_quota"
  | "coding"
  | "answered"
  | "errored";

export interface InboundOutcome {
  replyChunks: string[];
  meter: InboundMeter | null;
  branch: InboundBranch;
}

/** Resolved owner of a verified phone link. */
export interface ResolvedUser {
  userId: string;
  tier: string;
}

export interface AgentTurnResultLike {
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

/** The IO the orchestrator needs — injected so it's testable with stubs. */
export interface InboundDeps {
  consumePairing(code: string, e164: string): Promise<{ userId: string } | null>;
  resolveUserByPhone(e164: string): Promise<ResolvedUser | null>;
  /** Mint + store a single-use magic sign-up link for an unknown number, so a
   *  stranger can sign up and auto-link THIS number (hijack-proof). Returns the
   *  absolute URL to text back. */
  mintSignupLink(e164: string): Promise<string>;
  /** True when the user is within quota for an estimated turn. */
  withinQuota(userId: string, tier: string): Promise<boolean>;
  /** Build the context for this turn. `query` is the incoming message, used to
   *  retrieve the most RELEVANT memories (the "brain section" for what they're
   *  talking about) on top of identity + recent facts. */
  loadProfile(
    userId: string,
    query: string,
  ): Promise<{ profile: TierAProfile | null; dynamicContext: string }>;
  runTurn(input: {
    prompt: string;
    profile: TierAProfile | null;
    dynamicContext: string;
    maxTokens: number;
    model?: string;
    history?: ConversationTurn[];
    tools?: ToolDef[];
    onToolCall?: (name: string, input: unknown) => Promise<string>;
  }): Promise<AgentTurnResultLike>;
  /** The recent back-and-forth (oldest→newest) so eri isn't a one-off AI — it
   *  remembers what it just asked and what you just said. */
  loadConversation(userId: string): Promise<ConversationTurn[]>;
  /** Append this exchange (user text + eri's reply) to the running conversation.
   *  Best-effort — must never throw or block the reply. */
  recordConversation(userId: string, userText: string, assistantText: string): Promise<void>;
  /** Log an eri reply as a behavioral signal (default 'kept') — the KTO dataset.
   *  Best-effort, never throws. */
  recordSignal(userId: string, prompt: string, response: string, model: string): Promise<void>;
  /** The user corrected eri's previous reply → flip the most recent signal to
   *  'rejected' (a KTO negative). Best-effort, never throws. */
  rejectRecentSignal(userId: string): Promise<void>;
  /** Dispatch a goal to the user's computer (command queue). `kind` selects the
   *  remote turn: "control" (actuation) or "recall" (deep memory lookup, goal is
   *  a JSON spec). Returns false when the user is at the outstanding-command cap. */
  enqueueComputerGoal(userId: string, goal: string, kind?: CommandKind): Promise<boolean>;
  /** Save a durable fact/preference about the user to cloud-primary memory
   *  (learned_facts), tagged with a `category` ("brain section") so eri can recall
   *  the relevant slice later. Returns false on a storage failure. In-cloud — not
   *  a computer dispatch. */
  rememberUserFact(userId: string, fact: string, kind: string, category: string): Promise<boolean>;
  /** In-cloud connector reads (Gmail/Calendar) so eri can answer inbox/day
   *  questions even with the laptop closed. Same seam shape as proactive SignalDeps. */
  connectors: ConnectorDeps;
  /** In-cloud web search so eri can answer real-time/factual questions. */
  webSearch: WebSearchDeps;
  /** In-cloud real-time weather (Open-Meteo) — accurate, unlike search snippets. */
  weather: WeatherDeps;
  /** Answer about a photo the user sent (Claude vision). Single-shot, no tools. */
  runVisionTurn(input: { imageUrl: string; prompt: string; system: string }): Promise<AgentTurnResultLike>;
  /** Hand a classified coding task to the brain's CodeTurn job (Phase 3, P1). The
   *  job runs in a cloud sandbox — clone → plan → edit → run tests → open a PR —
   *  and streams status back over its own channel (P2). Returns an ack to text
   *  the user immediately ("on it — cloning …"), or null to DECLINE (repo not
   *  linked → P4 connect-flow, or the feature is off) so the message falls through
   *  to normal chat. Optional: while unset (the CodeTurn contract isn't wired yet),
   *  coding-shaped messages are answered as normal chat — additive, no behavior
   *  change. Single-principal + reversible (opens a PR, never merges), so there's
   *  no confirm gate here; merging/destructive stays gated on the computer. */
  dispatchCodingJob?(userId: string, intent: CodingIntent): Promise<{ ack: string } | null>;
  /** Approve the user's latest awaiting-confirm command; returns its goal or null. */
  confirmPending(userId: string): Promise<{ goal: string } | null>;
  /** Cancel the user's latest awaiting-confirm command; true if there was one. */
  cancelPending(userId: string): Promise<boolean>;
  now(): number;
}

/**
 * Decide the reply + metering for one inbound message. Pure of transport: never
 * verifies the secret, touches the lease, writes usage, or sends — the route
 * does those. A model failure is caught here and becomes a friendly reply (so a
 * bad turn never crashes the route or loses the lease).
 */
export async function handleInbound(
  msg: InboundMessage,
  e164: string,
  deps: InboundDeps,
): Promise<InboundOutcome> {
  // Resolve first: a number that's already a known user is handled as a normal
  // message, never as a pairing attempt — so a linked user texting something
  // code-shaped ("Sounds") is answered, not mis-parsed (review L3).
  const user = await deps.resolveUserByPhone(e164);
  if (!user) {
    // Unknown number — its only valid first move is to text a pairing code.
    const code = extractPairingCode(msg.content);
    if (code) {
      const paired = await deps.consumePairing(code, e164);
      if (paired) return { replyChunks: [REPLY.linked], meter: null, branch: "paired" };
    }
    // Unknown number → text a magic sign-up link. Tap → sign up on web → the link
    // auto-links THIS number (the number is fixed by the token, so it's hijack-proof).
    let reply: string = REPLY.notLinked;
    try {
      reply = `${REPLY.welcomeNew}\n\n${await deps.mintSignupLink(e164)}`;
    } catch {
      // fall back to the generic reply if minting fails
    }
    return { replyChunks: [reply], meter: null, branch: "not_linked" };
  }
  if (featureLocked(user.tier, "phoneEri")) {
    return { replyChunks: [REPLY.locked], meter: null, branch: "locked" };
  }

  // A natural "yes, go" / "no" answers a pending confirmation rather than
  // starting a new turn (review H1) — only acts if something is actually waiting,
  // so a bare "ok" with nothing pending falls through to a normal reply.
  if (isAffirmation(msg.content)) {
    const confirmed = await deps.confirmPending(user.userId);
    if (confirmed) return { replyChunks: [REPLY.confirmed], meter: null, branch: "confirmed" };
  } else if (isNegation(msg.content)) {
    if (await deps.cancelPending(user.userId)) {
      return { replyChunks: [REPLY.cancelled], meter: null, branch: "cancelled" };
    }
  }

  // KTO signal: if this message corrects eri's previous reply, flip that reply's
  // logged signal to 'rejected' (a training negative). Best-effort, fire-and-forget.
  if (isCorrection(msg.content)) {
    void deps.rejectRecentSignal(user.userId);
  }

  if (!(await deps.withinQuota(user.userId, user.tier))) {
    return { replyChunks: [REPLY.overQuota], meter: null, branch: "over_quota" };
  }

  // Coding task (Phase 3 wedge) → hand off to the brain's CodeTurn job instead of
  // a chat turn. Gated on the dispatch dep: while it's unset (the contract isn't
  // wired yet), a coding-shaped message just falls through to normal chat below —
  // additive, zero behavior change. A declined dispatch (null: repo not linked /
  // feature off) also falls through. No phone-side meter: the job meters its own
  // tokens in the brain, so `meter` stays null (like a computer dispatch).
  // Text only — a photo (even with a coding-ish caption) stays on the vision path.
  if (deps.dispatchCodingJob && !msg.mediaUrl) {
    const intent = classifyCodingIntent(msg.content);
    if (intent) {
      const ack = await deps.dispatchCodingJob(user.userId, intent);
      if (ack) return { replyChunks: formatReply(ack.ack), meter: null, branch: "coding" };
    }
  }

  const { profile, dynamicContext } = await deps.loadProfile(user.userId, msg.content);
  // How many bubbles eri may mirror back for this user (1 = terse single reply).
  // From the learned cadence facet (brain projection or the TS fallback); absent
  // → 1, which makes the reply split identical to the old single-message behavior.
  const maxBubbles = profile?.cadence?.maxBubbles ?? 1;
  // The running conversation so eri remembers what was just said (not a one-off AI).
  const history = await deps.loadConversation(user.userId);
  const started = deps.now();

  // A photo → answer about the image directly (Claude vision, single-shot). eri
  // sees what you sent and replies, instead of "I can't look at images."
  if (msg.mediaUrl) {
    try {
      const turn = await deps.runVisionTurn({
        imageUrl: msg.mediaUrl,
        prompt: msg.content,
        system: buildSystemPrompt(profile, dynamicContext, currentDateText()),
      });
      await deps.recordConversation(user.userId, msg.content || "(sent a photo)", turn.text);
      await deps.recordSignal(user.userId, msg.content || "(photo)", turn.text, turn.model);
      return {
        replyChunks: splitIntoBubbles(turn.text, maxBubbles),
        meter: {
          userId: user.userId,
          model: turn.model,
          tokensIn: turn.tokensIn,
          tokensOut: turn.tokensOut,
          latencyMs: deps.now() - started,
          status: "ok",
        },
        branch: "answered",
      };
    } catch {
      return {
        replyChunks: formatReply(REPLY.errored),
        meter: {
          userId: user.userId,
          model: DEFAULT_MODEL,
          tokensIn: 0,
          tokensOut: 0,
          latencyMs: deps.now() - started,
          status: "error",
        },
        branch: "errored",
      };
    }
  }

  // At most one computer dispatch per text — a single message rarely needs to
  // queue two independent goals, and it removes the per-turn hop multiplier (H3).
  let dispatched = false;
  try {
    const turn = await deps.runTurn({
      prompt: msg.content,
      profile,
      dynamicContext,
      history,
      maxTokens: 700,
      // Haiku for snappy chat replies (cloud pivot) — heavy work still escalates
      // to the computer via control_computer.
      model: PHONE_REPLY_MODEL,
      // Tools split by where they resolve. IN-CLOUD this turn (no computer, not
      // gated by the single-dispatch guard): remember_fact saves a durable fact;
      // check_email / check_calendar read Gmail/Calendar server-side so eri can
      // answer inbox/day questions laptop-closed. DISPATCHED to the machine:
      // control_computer (an action) and recall_memory (deep Tier-B lookup).
      tools: [
        CONTROL_COMPUTER_TOOL,
        RECALL_MEMORY_TOOL,
        REMEMBER_FACT_TOOL,
        CHECK_EMAIL_TOOL,
        CHECK_CALENDAR_TOOL,
        WEB_SEARCH_TOOL,
        WEATHER_TOOL,
      ],
      onToolCall: async (name, toolInput) => {
        // In-cloud tools run regardless of the single-dispatch guard (they don't
        // touch the computer), so eri can e.g. save a fact AND dispatch in one turn.
        if (name === "remember_fact") {
          const fact = (toolInput as { fact?: unknown })?.fact;
          if (typeof fact !== "string" || !fact.trim()) return "No fact was provided.";
          const kindRaw = (toolInput as { kind?: unknown })?.kind;
          const kind = kindRaw === "preference" ? "preference" : "fact";
          const catRaw = (toolInput as { category?: unknown })?.category;
          const category =
            typeof catRaw === "string" && catRaw.trim() ? catRaw.trim().toLowerCase() : "general";
          const ok = await deps.rememberUserFact(user.userId, fact.trim(), kind, category);
          return ok ? "Saved — eri will remember that." : "Couldn't save that just now.";
        }
        if (name === "check_email") {
          return formatEmails(await readRecentEmails(user.userId, deps.connectors));
        }
        if (name === "check_calendar") {
          return formatEvents(await readUpcomingEvents(user.userId, deps.connectors));
        }
        if (name === "web_search") {
          const q = (toolInput as { query?: unknown })?.query;
          if (typeof q !== "string" || !q.trim()) return "No search query was provided.";
          return formatResults(await webSearch(q.trim(), deps.webSearch));
        }
        if (name === "get_weather") {
          const city = (toolInput as { city?: unknown })?.city;
          if (typeof city !== "string" || !city.trim()) return "No city was provided.";
          return formatWeather(await getWeather(city.trim(), deps.weather));
        }
        if (dispatched) return "Already dispatched one task for this message; wait for it to finish.";
        // One enqueue path so the cap + single-dispatch guard live in one place;
        // `kind` routes the turn on the computer (actuation vs deep recall).
        const dispatch = async (goal: string, kind: CommandKind): Promise<string> => {
          const ok = await deps.enqueueComputerGoal(user.userId, goal, kind);
          if (!ok) {
            return "The user already has several tasks queued — ask them to wait for those to finish first.";
          }
          dispatched = true;
          return "Dispatched to the user's computer; it will run shortly and text back the result.";
        };
        if (name === "control_computer") {
          const goal = (toolInput as { goal?: unknown })?.goal;
          if (typeof goal !== "string" || !goal.trim()) return "No goal was provided.";
          return dispatch(goal.trim(), "control");
        }
        if (name === "recall_memory") {
          const query = (toolInput as { query?: unknown })?.query;
          if (typeof query !== "string" || !query.trim()) return "No query was provided.";
          const asOfRaw = (toolInput as { as_of?: unknown })?.as_of;
          const asOf = typeof asOfRaw === "string" ? asOfRaw : undefined;
          return dispatch(buildRecallPayload(query.trim(), asOf), "recall");
        }
        return `Unknown tool: ${name}`;
      },
    });
    await deps.recordConversation(user.userId, msg.content, turn.text);
    await deps.recordSignal(user.userId, msg.content, turn.text, turn.model);
    return {
      replyChunks: formatReply(turn.text),
      meter: {
        userId: user.userId,
        model: turn.model,
        tokensIn: turn.tokensIn,
        tokensOut: turn.tokensOut,
        latencyMs: deps.now() - started,
        status: "ok",
      },
      branch: "answered",
    };
  } catch {
    return {
      replyChunks: formatReply(REPLY.errored),
      meter: {
        // The turn failed before returning a model id; record the model it
        // would have used (the runTurn default) rather than a magic string that
        // can drift from what was actually attempted.
        userId: user.userId,
        model: DEFAULT_MODEL,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: deps.now() - started,
        status: "error",
      },
      branch: "errored",
    };
  }
}
