// MercuryAgent — always-free diffusion path. Routes to the sidecar's
// `eri/inference/iterate` notification, which is free across all tiers.

import { Sidecar } from "../sidecar";
import { AgentBackend, AgentDescriptor, AgentStreamEvent, AgentTurn } from "./types";
import { collectActiveDiagnostics } from "../composer/diagnosticsCollector";

export interface MercuryAgentOptions {
  readonly getSidecar: () => Sidecar | null;
}

export class MercuryAgent implements AgentBackend {
  constructor(private readonly opts: MercuryAgentOptions) {}

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
    sidecar.notify("eri/inference/iterate", {
      agentId: descriptor.id,
      prompt: turn.prompt,
      workspaceRoot: turn.workspaceRoot,
      context: turn.context,
      // Phase 16b — surface active linter/LSP diagnostics so the model
      // sees what's broken before editing. Aggressively capped on both
      // the IDE and sidecar sides; safe to call even when there are 0
      // diagnostics (returns []).
      diagnostics: collectActiveDiagnostics(),
      // Phase 16a — multimodal image attachments. Empty when the user
      // didn't pin any images via @Image.
      images: turn.context.images ?? [],
    });
    yield {
      kind: "done",
      payload: { routedTo: descriptor.id },
    };
  }
}
