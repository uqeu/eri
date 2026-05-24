"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Throttle = exports.PreviewRelay = void 0;
const MAX_HZ = 30;
const MIN_INTERVAL_MS = Math.floor(1000 / MAX_HZ);
/// Forwards gaze samples to the Swift preview window via the sidecar's
/// `eri/preview/gaze` JSON-RPC method. Heavy throttle (30 Hz max).
/// Stops silently when the preview window is not running.
class PreviewRelay {
    service;
    getSidecar;
    subscription;
    lastRelayAt = 0;
    constructor(service, getSidecar) {
        this.service = service;
        this.getSidecar = getSidecar;
        this.subscription = this.service.onGaze((point) => this.handlePoint(point));
    }
    isEnabled() {
        const config = globalThis.vscode;
        // The unit tests stub `vscode`; access defensively.
        if (!config?.workspace) {
            return true;
        }
        return config.workspace
            .getConfiguration("eri.gaze")
            .get("previewRelay", true);
    }
    handlePoint(point) {
        if (!this.isEnabled()) {
            return;
        }
        const now = Date.now();
        if (now - this.lastRelayAt < MIN_INTERVAL_MS) {
            return;
        }
        this.lastRelayAt = now;
        const sidecar = this.getSidecar();
        if (!sidecar) {
            return;
        }
        sidecar.notify("eri/preview/gaze", {
            x: point.x,
            y: point.y,
            confidence: point.confidence,
            tsMs: point.tsMs,
        });
    }
    dispose() {
        this.subscription.dispose();
    }
}
exports.PreviewRelay = PreviewRelay;
/// Pure throttle helper exposed for tests.
class Throttle {
    minIntervalMs;
    last = null;
    constructor(minIntervalMs) {
        this.minIntervalMs = minIntervalMs;
    }
    tick(now) {
        if (this.last !== null && now - this.last < this.minIntervalMs) {
            return false;
        }
        this.last = now;
        return true;
    }
}
exports.Throttle = Throttle;
//# sourceMappingURL=previewRelay.js.map