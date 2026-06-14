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

import type { TierAProfile } from "@/lib/agent/run_core";
import { featureLocked } from "@/lib/feature_gate";
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
  }): Promise<AgentTurnResultLike>;
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
  if (!(await deps.withinQuota(user.userId, user.tier))) {
    return { replyChunks: [REPLY.overQuota], meter: null, branch: "over_quota" };
  }

  const { profile, dynamicContext } = await deps.loadProfile(user.userId);
  const started = deps.now();
  try {
    const turn = await deps.runTurn({ prompt: msg.content, profile, dynamicContext, maxTokens: 700 });
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
