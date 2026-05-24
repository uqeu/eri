"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GazeService = void 0;
exports.regionFromPoint = regionFromPoint;
exports.parseGazePoint = parseGazePoint;
const vscode = require("vscode");
const GAZE_POINT_METHOD = "eri/gaze/point";
const GAZE_LOST_METHOD = "eri/gaze/lost";
const GAZE_CALIBRATION_REQUIRED = "eri/gaze/calibration/required";
const DEFAULT_DWELL_MS = 800;
/// Region geometry — coarse rectangles derived from typical editor
/// layouts. Refining these to real layout queries is a future step;
/// today they're stable enough for an attention signal.
const REGION_BOXES = [
    { region: "title", xMin: 0, xMax: 1, yMin: 0, yMax: 0.05 },
    { region: "statusbar", xMin: 0, xMax: 1, yMin: 0.95, yMax: 1 },
    { region: "sidebar", xMin: 0, xMax: 0.18, yMin: 0.05, yMax: 0.95 },
    { region: "auxbar", xMin: 0.82, xMax: 1, yMin: 0.05, yMax: 0.95 },
    { region: "panel", xMin: 0.18, xMax: 0.82, yMin: 0.7, yMax: 0.95 },
    { region: "editor", xMin: 0.18, xMax: 0.82, yMin: 0.05, yMax: 0.7 },
];
function regionFromPoint(point) {
    for (const box of REGION_BOXES) {
        if (point.x >= box.xMin &&
            point.x < box.xMax &&
            point.y >= box.yMin &&
            point.y < box.yMax) {
            return box.region;
        }
    }
    return "unknown";
}
class GazeService {
    options;
    emitter = new vscode.EventEmitter();
    attentionEmitter = new vscode.EventEmitter();
    subscriptions = [];
    // Dwell tracker state — smoothed via EMA so a single jittery sample
    // doesn't fire a spurious AttentionEvent.
    smoothed = null;
    currentRegion = null;
    regionEnterAt = 0;
    hasEnteredFired = false;
    lastPoint = null;
    running = false;
    onGaze = this.emitter.event;
    onAttention = this.attentionEmitter.event;
    constructor(options) {
        this.options = options;
    }
    async start() {
        const sidecar = this.options.getSidecar();
        if (!sidecar) {
            return;
        }
        try {
            await sidecar.request("eri/gaze/start", {});
            this.running = true;
        }
        catch (err) {
            console.warn("[eri-gaze] start failed", err);
        }
    }
    async stop() {
        const sidecar = this.options.getSidecar();
        if (!sidecar) {
            this.running = false;
            return;
        }
        try {
            await sidecar.request("eri/gaze/stop", {});
        }
        catch (err) {
            console.warn("[eri-gaze] stop failed", err);
        }
        this.running = false;
    }
    isRunning() {
        return this.running;
    }
    getLastPoint() {
        return this.lastPoint;
    }
    /// Called by the extension's notification fan-out for every sidecar
    /// notification. Filters down to gaze events and parses defensively.
    forward(notification) {
        if (notification.method === GAZE_LOST_METHOD) {
            this.handleLost();
            return;
        }
        if (notification.method === GAZE_CALIBRATION_REQUIRED) {
            this.handleCalibrationRequired();
            return;
        }
        if (notification.method !== GAZE_POINT_METHOD) {
            return;
        }
        const point = parseGazePoint(notification.params);
        if (!point) {
            return;
        }
        this.handlePoint(point);
    }
    handlePoint(point) {
        this.lastPoint = point;
        this.emitter.fire(point);
        this.updateAttention(point);
    }
    handleLost() {
        this.fireLeaveIfActive();
        this.smoothed = null;
        this.currentRegion = null;
        this.hasEnteredFired = false;
    }
    handleCalibrationRequired() {
        this.handleLost();
    }
    /// Update the EMA-smoothed gaze position and fire enter/leave attention
    /// events when the region changes or the dwell threshold is crossed.
    updateAttention(point) {
        if (!this.smoothed) {
            this.smoothed = { x: point.x, y: point.y };
        }
        else {
            // Light EMA — alpha 0.25. Smooths jitter but stays responsive.
            this.smoothed = {
                x: this.smoothed.x * 0.75 + point.x * 0.25,
                y: this.smoothed.y * 0.75 + point.y * 0.25,
            };
        }
        const region = regionFromPoint(this.smoothed);
        const now = point.tsMs || Date.now();
        if (region !== this.currentRegion) {
            this.fireLeaveIfActive();
            this.currentRegion = region;
            this.regionEnterAt = now;
            this.hasEnteredFired = false;
            return;
        }
        if (this.hasEnteredFired || region === "unknown") {
            return;
        }
        const dwellMs = now - this.regionEnterAt;
        const threshold = this.options.dwellMs ?? DEFAULT_DWELL_MS;
        if (dwellMs >= threshold) {
            this.hasEnteredFired = true;
            this.attentionEmitter.fire({
                kind: "enter",
                region,
                dwellMs,
                point,
            });
        }
    }
    fireLeaveIfActive() {
        if (!this.currentRegion || !this.hasEnteredFired) {
            return;
        }
        const point = this.lastPoint;
        if (!point) {
            return;
        }
        this.attentionEmitter.fire({
            kind: "leave",
            region: this.currentRegion,
            dwellMs: (point.tsMs || Date.now()) - this.regionEnterAt,
            point,
        });
    }
    dispose() {
        this.emitter.dispose();
        this.attentionEmitter.dispose();
        for (const sub of this.subscriptions) {
            sub.dispose();
        }
        this.subscriptions.length = 0;
    }
}
exports.GazeService = GazeService;
/// Parse a `params` blob into a GazePoint, returning null on anything we
/// don't recognise. Done at the extension boundary — never trust sidecar
/// payload shape, even though we wrote it.
function parseGazePoint(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const params = raw;
    const x = numberInRange(params.x, 0, 1);
    const y = numberInRange(params.y, 0, 1);
    const confidence = numberInRange(params.confidence, 0, 1) ?? 0;
    const tsMs = typeof params.tsMs === "number" && Number.isFinite(params.tsMs)
        ? Math.floor(params.tsMs)
        : typeof params.ts_ms === "number" && Number.isFinite(params.ts_ms)
            ? Math.floor(params.ts_ms)
            : Date.now();
    if (x === null || y === null) {
        return null;
    }
    return { x, y, confidence, tsMs };
}
function numberInRange(value, min, max) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return null;
    }
    if (value < min || value > max) {
        return Math.max(min, Math.min(max, value));
    }
    return value;
}
//# sourceMappingURL=gazeService.js.map