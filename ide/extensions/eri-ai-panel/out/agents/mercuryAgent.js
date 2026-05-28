"use strict";
// MercuryAgent — always-free diffusion path. Routes to the sidecar's
// `eri/inference/iterate` notification, which is free across all tiers.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MercuryAgent = void 0;
const diagnosticsCollector_1 = require("../composer/diagnosticsCollector");
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
            // Phase 16b — surface active linter/LSP diagnostics so the model
            // sees what's broken before editing. Aggressively capped on both
            // the IDE and sidecar sides; safe to call even when there are 0
            // diagnostics (returns []).
            diagnostics: (0, diagnosticsCollector_1.collectActiveDiagnostics)(),
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
exports.MercuryAgent = MercuryAgent;
//# sourceMappingURL=mercuryAgent.js.map