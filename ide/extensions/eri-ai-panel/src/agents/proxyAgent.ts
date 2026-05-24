// Proxy-backend agent — dispatches the turn through the sidecar's
// inference proxy. The sidecar handles transport (SSE / JSON-RPC) and
// quota tracking; we just translate descriptor + turn to a notification
// and forward streamed events to the caller.
//
// The sidecar streams back `eri/inference/delta` notifications which
// arrive globally (see extension.ts wiring). For now we don't try to
// re-route those into per-call iterators — instead we synthesize a
// minimal "done" event after the sidecar accepts the dispatch and rely
// on the existing panel webview channel to render token deltas. A full
// per-call stream multiplexer is tracked separately.

import { Sidecar } from "../sidecar";
import { AgentBackend, AgentDescriptor, AgentStreamEvent, AgentTurn } from "./types";

export interface ProxyAgentOptions {
  readonly getSidecar: () => Sidecar | null;
}

export class ProxyAgent implements AgentBackend {
  constructor(private readonly opts: ProxyAgentOptions) {}

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
      kind: descriptor.kind,
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
