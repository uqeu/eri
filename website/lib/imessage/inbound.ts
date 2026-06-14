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

import { CONTROL_COMPUTER_TOOL, type TierAProfile, type ToolDef } from "@/lib/agent/run_core";
import { featureLocked } from "@/lib/feature_gate";
import { isAffirmation, isNegation } from "@/lib/imessage/affirm";
import { formatReply } from "@/lib/imessage/format";
import { extractPairingCode } from "@/lib/imessage/identity";
import type { InboundMessage } from "@/lib/imessage/webhook";

export const REPLY = {
  notLinked:
    "Hey! I don't recognize this number yet 🌿 Run `eri phone link` on your computer and text me the code it gives you to connect.",
  linked: 'You\'re linked! 🌿 Text me anything — I know your day. Try "what was I working on?"',
  locked: "Texting with eri is a Pro+ feature — upgrade at tryeri.ca to chat with me here.",
  overQuota:
    "You're out of eri credits for this cycle — they reset next period, or upgrade at tryeri.ca.",
  errored: "Sorry — I hit a snag answering that. Try me again in a sec 🌿",
  confirmed: "On it — I'll text you the moment it's done. 🌿",
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
  /** True when the user is within quota for an estimated turn. */
  withinQuota(userId: string, tier: string): Promise<boolean>;
  loadProfile(userId: string): Promise<{ profile: TierAProfile | null; dynamicContext: string }>;
  runTurn(input: {
    prompt: string;
    profile: TierAProfile | null;
    dynamicContext: string;
    maxTokens: number;
    tools?: ToolDef[];
    onToolCall?: (name: string, input: unknown) => Promise<string>;
  }): Promise<AgentTurnResultLike>;
  /** Dispatch a goal to the user's computer (command queue). Returns false when
   *  the user is at the outstanding-command cap. */
  enqueueComputerGoal(userId: string, goal: string): Promise<boolean>;
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
    return { replyChunks: [REPLY.notLinked], meter: null, branch: "not_linked" };
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

  if (!(await deps.withinQuota(user.userId, user.tier))) {
    return { replyChunks: [REPLY.overQuota], meter: null, branch: "over_quota" };
  }

  const { profile, dynamicContext } = await deps.loadProfile(user.userId);
  const started = deps.now();
  // At most one computer dispatch per text — a single message rarely needs to
  // queue two independent goals, and it removes the per-turn hop multiplier (H3).
  let dispatched = false;
  try {
    const turn = await deps.runTurn({
      prompt: msg.content,
      profile,
      dynamicContext,
      maxTokens: 700,
      tools: [CONTROL_COMPUTER_TOOL],
      // When the model decides the request needs the user's machine, dispatch it
      // to the command queue; the computer-resident eri runs it and texts back.
      onToolCall: async (name, toolInput) => {
        if (name !== "control_computer") return `Unknown tool: ${name}`;
        if (dispatched) return "Already dispatched one task for this message; wait for it to finish.";
        const goal = (toolInput as { goal?: unknown })?.goal;
        if (typeof goal !== "string" || !goal.trim()) return "No goal was provided.";
        const ok = await deps.enqueueComputerGoal(user.userId, goal.trim());
        if (!ok) {
          return "The user already has several tasks queued — ask them to wait for those to finish first.";
        }
        dispatched = true;
        return "Dispatched to the user's computer; it will run shortly and text back the result.";
      },
    });
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
        userId: user.userId,
        model: "claude-sonnet-4-6",
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: deps.now() - started,
        status: "error",
      },
      branch: "errored",
    };
  }
}
