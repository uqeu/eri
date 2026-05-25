"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShipClient = void 0;
const vscode = require("vscode");
/**
 * Thin client around the `eri/ship/run` JSON-RPC call. Tracks one
 * in-flight ship at a time; concurrent calls reject with a clear error
 * so the UI can warn instead of double-billing.
 */
class ShipClient {
    getSidecar;
    inflight = false;
    eventEmitter = new vscode.EventEmitter();
    onEvent = this.eventEmitter.event;
    constructor(getSidecar) {
        this.getSidecar = getSidecar;
    }
    /**
     * Route every `eri/ship/event` notification into this client's emitter.
     * Wired from the extension's central notification handler.
     */
    forward(notification) {
        if (notification.method !== "eri/ship/event") {
            return;
        }
        if (notification.params && typeof notification.params === "object") {
            this.eventEmitter.fire(notification.params);
        }
    }
    async run(request) {
        if (this.inflight) {
            throw new Error("ship_in_progress");
        }
        const sidecar = this.getSidecar();
        if (!sidecar) {
            throw new Error("sidecar_not_running");
        }
        this.inflight = true;
        try {
            const raw = await sidecar.request("eri/ship/run", {
                instructions: request.instructions,
                workspaceFiles: request.workspaceFiles,
                plan: request.plan ?? null,
            });
            return {
                ok: raw.ok ?? false,
                survivors: raw.survivors ?? [],
                totalTokensIn: raw.totalTokensIn ?? 0,
                totalTokensOut: raw.totalTokensOut ?? 0,
                totalCostMicros: raw.totalCostMicros ?? 0,
                mergedPatchset: raw.mergedPatchset ?? "",
            };
        }
        finally {
            this.inflight = false;
        }
    }
    dispose() {
        this.eventEmitter.dispose();
    }
}
exports.ShipClient = ShipClient;
//# sourceMappingURL=shipClient.js.map