"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PreviewClient = void 0;
/**
 * Thin client over the sidecar's `eri/preview/*` JSON-RPC surface. All
 * methods are no-ops when the sidecar is offline so callers can fire-and-
 * forget without try/catch noise.
 */
class PreviewClient {
    getSidecar;
    constructor(getSidecar) {
        this.getSidecar = getSidecar;
    }
    async open(url, binaryPath) {
        const sidecar = this.getSidecar();
        if (!sidecar) {
            return null;
        }
        const params = {};
        if (url !== undefined && url !== "") {
            params.url = url;
        }
        if (binaryPath !== undefined && binaryPath !== "") {
            params.binaryPath = binaryPath;
        }
        const raw = await sidecar.request("eri/preview/open", params);
        return normalizeStatus(raw);
    }
    async close() {
        const sidecar = this.getSidecar();
        if (!sidecar) {
            return;
        }
        await sidecar.request("eri/preview/close", {});
    }
    async reload() {
        const sidecar = this.getSidecar();
        if (!sidecar) {
            return;
        }
        await sidecar.request("eri/preview/reload", {});
    }
    async load(url) {
        const sidecar = this.getSidecar();
        if (!sidecar) {
            return;
        }
        await sidecar.request("eri/preview/load", { url });
    }
    /**
     * Push a relative-coord gaze hit (0..1, origin top-left of the preview
     * webview) for the Swift app to render as a soft cursor dot. Used by the
     * gaze module's `previewRelay` — high-frequency, best-effort.
     */
    relayGaze(x, y) {
        const sidecar = this.getSidecar();
        if (!sidecar) {
            return;
        }
        // Fire-and-forget. The sidecar handler is intentionally lenient.
        sidecar.notify("eri/preview/gaze", { x, y });
    }
    async status() {
        const sidecar = this.getSidecar();
        if (!sidecar) {
            return { running: false };
        }
        const raw = await sidecar.request("eri/preview/status", {});
        return normalizeStatus(raw);
    }
}
exports.PreviewClient = PreviewClient;
function normalizeStatus(raw) {
    if (!raw || typeof raw !== "object") {
        return { running: false };
    }
    const status = {
        running: raw.running === true,
        ...(typeof raw.pid === "number" ? { pid: raw.pid } : {}),
        ...(typeof raw.lastUrl === "string" ? { lastUrl: raw.lastUrl } : {}),
    };
    return status;
}
//# sourceMappingURL=previewClient.js.map