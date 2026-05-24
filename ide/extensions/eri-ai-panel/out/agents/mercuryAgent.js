"use strict";
// MercuryAgent — always-free diffusion path. Routes to the sidecar's
// `eri/inference/iterate` notification, which is free across all tiers.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MercuryAgent = void 0;
class MercuryAgent {
    opts;
    constructor(opts) {
        this.opts = opts;
    }
    async *run(descriptor, turn, signal) {
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
        });
        yield {
            kind: "done",
            payload: { routedTo: descriptor.id },
        };
    }
}
exports.MercuryAgent = MercuryAgent;
//# sourceMappingURL=mercuryAgent.js.map