// AutoAgent — routes each turn to a concrete underlying agent based on
// the eri brain's classification of the prompt. Falls back to Mercury
// when the brain is unavailable. The routing decision is emitted in the
// final `done` event so the status bar can surface "routed to X".

import { Sidecar } from "../sidecar";
import { AGENT_ID } from "./builtins";
import {
  AgentBackend,
  AgentDescriptor,
  AgentStreamEvent,
  AgentTurn,
} from "./types";

export interface AutoAgentOptions {
  readonly getSidecar: () => Sidecar | null;
  /** Resolve the descriptor of the chosen routing target so we can dispatch. */
  readonly resolve: (id: string) => AgentDescriptor | undefined;
  readonly mercury: AgentBackend;
  readonly proxy: AgentBackend;
}

interface BrainPlanResponse {
  readonly intent?: string;
  readonly route?: string;
}

export class AutoAgent implements AgentBackend {
  constructor(private readonly opts: AutoAgentOptions) {}

  async *run(
    _descriptor: AgentDescriptor,
    turn: AgentTurn,
    signal: AbortSignal,
  ): AsyncIterable<AgentStreamEvent> {
    const targetId = await this.classify(turn);
    const target = this.opts.resolve(targetId) ?? this.opts.resolve(AGENT_ID.mercury);
    if (!target) {
      yield {
        kind: "error",
        payload: { kind: "unknown", message: "no fallback agent" },
      };
      return;
    }
    const backend = target.id === AGENT_ID.mercury ? this.opts.mercury : this.opts.proxy;
    let lastDone: AgentStreamEvent | null = null;
    for await (const event of backend.run(target, turn, signal)) {
      if (event.kind === "done") {
        lastDone = event;
        continue;
      }
      yield event;
    }
    const payload =
      lastDone && typeof lastDone.payload === "object" && lastDone.payload !== null
        ? { ...(lastDone.payload as Record<string, unknown>), routedTo: target.id }
        : { routedTo: target.id };
    yield { kind: "done", payload };
  }

  private async classify(turn: AgentTurn): Promise<string> {
    const sidecar = this.opts.getSidecar();
    if (!sidecar) {
      return AGENT_ID.mercury;
    }
    try {
      const result = (await sidecar.request("eri/brain/plan", {
        prompt: turn.prompt,
      })) as BrainPlanResponse | null;
      if (result && typeof result.route === "string") {
        return mapRouteToAgentId(result.route);
      }
      if (result && typeof result.intent === "string") {
        return mapIntentToAgentId(result.intent);
      }
    } catch {
      // brain unavailable — fall through to Mercury.
    }
    return AGENT_ID.mercury;
  }
}

function mapRouteToAgentId(route: string): string {
  switch (route) {
    case "mercury":
    case "edit":
    case "build":
    case "refactor":
      return AGENT_ID.mercury;
    case "claude":
    case "debug":
    case "explain":
      return AGENT_ID.claudeProxy;
    case "gpt":
      return AGENT_ID.gptProxy;
    case "gemini":
      return AGENT_ID.geminiProxy;
    default:
      return AGENT_ID.mercury;
  }
}

function mapIntentToAgentId(intent: string): string {
  const lower = intent.toLowerCase();
  if (lower.includes("debug") || lower.includes("explain") || lower.includes("analyze")) {
    return AGENT_ID.claudeProxy;
  }
  return AGENT_ID.mercury;
}
