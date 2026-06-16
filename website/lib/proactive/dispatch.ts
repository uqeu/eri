/**
 * Proactive dispatch — decide + compose + send one nudge (injected deps).
 *
 * Pure of transport like `handleInbound`: the gate, the model's SKIP judgment,
 * and the branch logic are all here behind a deps seam, so every path is
 * unit-tested with stubs (no DB, model, or Sendblue). The cron route wires the
 * real IO. A model/send failure becomes a branch, never a throw that aborts the
 * whole sweep.
 */

import type { TierAProfile } from "@/lib/agent/run_core";
import { formatReply } from "@/lib/imessage/format";
import { composeProactivePrompt, isSkip } from "./compose";
import { decideGate, type GateState } from "./gate";
import type { ProactiveTrigger } from "./types";

export type ProactiveBranch = "sent" | "gated" | "skipped" | "no_phone" | "errored";

export interface ProactiveMeter {
  userId: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface ProactiveResult {
  branch: ProactiveBranch;
  reason: string;
  /** The text actually sent (present only on "sent"). */
  text?: string;
  /** Tokens to meter (present whenever the model ran). */
  meter?: ProactiveMeter;
}

export interface ProactiveTurnResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

/** The IO the dispatcher needs — injected so the decision is testable. */
export interface ProactiveDeps {
  /** Gate inputs for this user+trigger (last-sent, today's count, dup check, local hour). */
  gateState(userId: string, trigger: ProactiveTrigger): Promise<GateState>;
  loadProfile(userId: string): Promise<{ profile: TierAProfile | null; dynamicContext: string }>;
  /** Resolve the user's verified iMessage number, or null if none. */
  resolvePhone(userId: string): Promise<string | null>;
  runTurn(input: {
    prompt: string;
    profile: TierAProfile | null;
    dynamicContext: string;
    maxTokens: number;
  }): Promise<ProactiveTurnResult>;
  send(to: string, chunks: string[]): Promise<boolean>;
  /** Persist that we sent this trigger (drives dedupe + rate-limit next sweep). */
  recordSent(userId: string, trigger: ProactiveTrigger, nowMs: number): Promise<void>;
}

/** Decide + (maybe) send one proactive nudge. Never throws. */
export async function dispatchProactive(
  userId: string,
  trigger: ProactiveTrigger,
  deps: ProactiveDeps,
): Promise<ProactiveResult> {
  try {
    const state = await deps.gateState(userId, trigger);
    const gate = decideGate(trigger, state);
    if (!gate.send) return { branch: "gated", reason: gate.reason };

    // Resolve the phone BEFORE the (paid) model turn. A user with no verified
    // number can never receive a nudge, so running the model first would bill
    // for output that's thrown away — short-circuit here with no runTurn, no meter.
    const phone = await deps.resolvePhone(userId);
    if (!phone) return { branch: "no_phone", reason: "no_verified_phone" };

    const { profile, dynamicContext } = await deps.loadProfile(userId);
    const turn = await deps.runTurn({
      prompt: composeProactivePrompt(trigger),
      profile,
      dynamicContext,
      maxTokens: 200,
    });
    const meter: ProactiveMeter = {
      userId,
      model: turn.model,
      tokensIn: turn.tokensIn,
      tokensOut: turn.tokensOut,
    };

    // The model's soft gate: it can decline even a gate-cleared trigger.
    if (isSkip(turn.text) || !turn.text.trim()) {
      return { branch: "skipped", reason: "model_skip", meter };
    }

    const sent = await deps.send(phone, formatReply(turn.text));
    if (!sent) return { branch: "errored", reason: "send_failed", meter, text: turn.text };

    // Only record AFTER a confirmed send, so a dropped message can be retried
    // next sweep rather than being silently deduped away.
    await deps.recordSent(userId, trigger, state.nowMs);
    return { branch: "sent", reason: "ok", text: turn.text, meter };
  } catch {
    return { branch: "errored", reason: "exception" };
  }
}
