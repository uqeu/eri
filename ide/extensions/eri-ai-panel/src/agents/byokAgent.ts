// BYOK-backend agent — same shape as ProxyAgent but instructs the
// sidecar to use the user's stored provider key directly (no quota
// metering, no eri-side billing). The actual provider HTTP call lives
// in the sidecar; this file is just the dispatch glue.

import { Sidecar } from "../sidecar";
import { AgentBackend, AgentDescriptor, AgentStreamEvent, AgentTurn } from "./types";

export interface ByokAgentOptions {
  readonly getSidecar: () => Sidecar | null;
}

export class ByokAgent implements AgentBackend {
  constructor(private readonly opts: ByokAgentOptions) {}

  async *run(
    descriptor: AgentDescriptor,
    turn: AgentTurn,
    signal: AbortSignal,
  ): AsyncIterable<AgentStreamEvent> {
    const sidecar = this.opts.getSidecar();
    if (!sidecar) {
      yield {
        kind: "error",
        payload: { kind: "network", message: "sidecar not running" },
      };
      return;
    }
    if (signal.aborted) {
      yield {
        kind: "error",
        payload: { kind: "unknown", message: "aborted before dispatch" },
      };
      return;
    }
    sidecar.notify("eri/agent/dispatch", {
      agentId: descriptor.id,
      model: descriptor.model,
      vendor: descriptor.vendor,
      kind: "byok",
      prompt: turn.prompt,
      workspaceRoot: turn.workspaceRoot,
      context: turn.context,
    });
    yield {
      kind: "done",
      payload: { routedTo: descriptor.id },
    };
  }
}
