"use strict";
// AutoAgent — routes each turn to a concrete underlying agent based on
// the eri brain's classification of the prompt. Falls back to Mercury
// when the brain is unavailable. The routing decision is emitted in the
// final `done` event so the status bar can surface "routed to X".
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoAgent = void 0;
const builtins_1 = require("./builtins");
class AutoAgent {
    opts;
    constructor(opts) {
        this.opts = opts;
    }
    async *run(_descriptor, turn, signal) {
        const targetId = await this.classify(turn);
        const target = this.opts.resolve(targetId) ?? this.opts.resolve(builtins_1.AGENT_ID.mercury);
        if (!target) {
            yield {
                kind: "error",
                payload: { kind: "unknown", message: "no fallback agent" },
            };
            return;
        }
        const backend = target.id === builtins_1.AGENT_ID.mercury ? this.opts.mercury : this.opts.proxy;
        let lastDone = null;
        for await (const event of backend.run(target, turn, signal)) {
            if (event.kind === "done") {
                lastDone = event;
                continue;
            }
            yield event;
        }
        const payload = lastDone && typeof lastDone.payload === "object" && lastDone.payload !== null
            ? { ...lastDone.payload, routedTo: target.id }
            : { routedTo: target.id };
        yield { kind: "done", payload };
    }
    async classify(turn) {
        const sidecar = this.opts.getSidecar();
        if (!sidecar) {
            return builtins_1.AGENT_ID.mercury;
        }
        try {
            const result = (await sidecar.request("eri/brain/plan", {
                prompt: turn.prompt,
            }));
            if (result && typeof result.route === "string") {
                return mapRouteToAgentId(result.route);
            }
            if (result && typeof result.intent === "string") {
                return mapIntentToAgentId(result.intent);
            }
        }
        catch {
            // brain unavailable — fall through to Mercury.
        }
        return builtins_1.AGENT_ID.mercury;
    }
}
exports.AutoAgent = AutoAgent;
function mapRouteToAgentId(route) {
    switch (route) {
        case "mercury":
        case "edit":
        case "build":
        case "refactor":
            return builtins_1.AGENT_ID.mercury;
        case "claude":
        case "debug":
        case "explain":
            return builtins_1.AGENT_ID.claudeProxy;
        case "gpt":
            return builtins_1.AGENT_ID.gptProxy;
        case "gemini":
            return builtins_1.AGENT_ID.geminiProxy;
        default:
            return builtins_1.AGENT_ID.mercury;
    }
}
function mapIntentToAgentId(intent) {
    const lower = intent.toLowerCase();
    if (lower.includes("debug") || lower.includes("explain") || lower.includes("analyze")) {
        return builtins_1.AGENT_ID.claudeProxy;
    }
    return builtins_1.AGENT_ID.mercury;
}
//# sourceMappingURL=autoAgent.js.map