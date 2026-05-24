"use strict";
// Gaze fusion for the Visual Editor.
//
// The sidecar reports gaze points relative to the screen. When the Visual
// Editor panel is visible we approximate iframe-relative coords by tracking
// dwell time and relaying the point to the shim so it can hit-test against
// the live DOM. After `dwellMs` of stable dwell on the same element the shim
// auto-picks - saving the user a manual click.
Object.defineProperty(exports, "__esModule", { value: true });
exports.GazeBridge = void 0;
const GAZE_METHODS = new Set([
    "eri/gaze/target",
    "eri/gaze/lost",
    "eri/gaze/point",
]);
// Movement tolerance (normalized units) below which we consider the gaze to
// be "stable" - i.e. dwelling on the same element.
const STABILITY_THRESHOLD = 0.02;
class GazeBridge {
    deps;
    lastPoint = null;
    dwellTimer = null;
    constructor(deps) {
        this.deps = deps;
    }
    forward(notification) {
        if (!GAZE_METHODS.has(notification.method)) {
            return;
        }
        if (!this.deps.isPanelActive()) {
            this.reset();
            return;
        }
        if (notification.method === "eri/gaze/lost") {
            this.reset();
            this.deps.relayToShim({ kind: "clearHighlight" });
            return;
        }
        const point = parseGazePoint(notification.params);
        if (!point) {
            return;
        }
        this.handlePoint(point);
    }
    dispose() {
        this.reset();
    }
    handlePoint(point) {
        const previous = this.lastPoint;
        this.lastPoint = point;
        // Always relay to shim so the highlight follows in real time.
        this.deps.relayToShim({
            kind: "highlightAtPoint",
            x: point.nx,
            y: point.ny,
        });
        if (!previous ||
            Math.abs(point.nx - previous.nx) > STABILITY_THRESHOLD ||
            Math.abs(point.ny - previous.ny) > STABILITY_THRESHOLD) {
            // Moved enough to count as a fresh dwell; reset timer.
            this.clearDwellTimer();
            this.scheduleAutoPick();
            return;
        }
        // Stable - leave existing timer in place.
        if (!this.dwellTimer) {
            this.scheduleAutoPick();
        }
    }
    scheduleAutoPick() {
        const dwellMs = Math.max(200, Math.floor(this.deps.getDwellMs()));
        this.dwellTimer = setTimeout(() => {
            // The shim translates "pickStart" into auto-pick when it has a
            // currently-highlighted element under the gaze point.
            this.deps.relayToShim({ kind: "pickStart" });
            this.deps.showStatus("gaze-picked element", "info");
            this.dwellTimer = null;
        }, dwellMs);
    }
    clearDwellTimer() {
        if (this.dwellTimer) {
            clearTimeout(this.dwellTimer);
            this.dwellTimer = null;
        }
    }
    reset() {
        this.lastPoint = null;
        this.clearDwellTimer();
    }
}
exports.GazeBridge = GazeBridge;
// Parse the sidecar gaze payload. Accepts:
//   { nx, ny }                  - normalized 0..1
//   { x, y, width, height }     - pixel coords (we normalize)
//   { kind: "panel", elementId } - ignored (we only fuse coord-based)
function parseGazePoint(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const obj = raw;
    const receivedAt = Date.now();
    if (typeof obj.nx === "number" && typeof obj.ny === "number") {
        return {
            nx: clamp01(obj.nx),
            ny: clamp01(obj.ny),
            receivedAt,
        };
    }
    if (typeof obj.x === "number" &&
        typeof obj.y === "number" &&
        typeof obj.width === "number" &&
        typeof obj.height === "number" &&
        obj.width > 0 &&
        obj.height > 0) {
        return {
            nx: clamp01(obj.x / obj.width),
            ny: clamp01(obj.y / obj.height),
            receivedAt,
        };
    }
    return null;
}
function clamp01(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    if (value < 0) {
        return 0;
    }
    if (value > 1) {
        return 1;
    }
    return value;
}
//# sourceMappingURL=gazeBridge.js.map