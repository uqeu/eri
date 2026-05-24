"use strict";
// Tracks which terminal the user is currently gazing at and surfaces an
// event so voice fusion can resolve pronouns ("kill it") to a real target.
//
// The actual eye-tracking data is delivered by the gaze sidecar via the
// existing notification stream. This module:
//   1. Filters for gaze targets that land on the terminal panel.
//   2. Smooths the signal with an EMA so we don't strobe.
//   3. Picks which specific terminal in the panel is being attended.
//   4. Emits TerminalGazeAttended { terminalId } when the dwell threshold
//      is crossed; emits null when attention leaves.
//
// When the gaze sidecar isn't reporting (no notifications arrive), this
// module is a no-op. No crashes, no fallbacks that fake gaze data.
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateTerminalGaze = activateTerminalGaze;
const vscode = require("vscode");
// Where the terminal panel lives on screen — bottom strip of the IDE.
// We can't query VS Code for the precise rect, so we model "is gaze on the
// terminal panel" as "ny is in the bottom band" when the panel is open.
const TERMINAL_BAND_TOP = 0.65;
const TERMINAL_BAND_BOTTOM = 1.0;
const EMA_ALPHA_DEFAULT = 0.35;
const MIN_DWELL_MS = 200;
const MAX_DWELL_MS = 3000;
const DEFAULT_DWELL_MS = 800;
const GAZE_POINT_METHODS = new Set([
    "eri/gaze/point",
    "gaze/point",
]);
function activateTerminalGaze(context, options = {}) {
    const clock = options.clockMs ?? (() => Date.now());
    const listTerminals = options.listTerminals ?? (() => vscode.window.terminals);
    const visible = options.visibleTerminalIds ?? (() => defaultVisibleTerminalIds(listTerminals));
    const emitter = new vscode.EventEmitter();
    let currentAttended = null;
    let state = {
        terminalId: null,
        emaScore: 0,
        firstSeenMs: clock(),
        lastUpdateMs: clock(),
    };
    function ingest(point) {
        if (!isGazeTargetingEnabled()) {
            return;
        }
        const dwellMs = readDwellMs();
        const candidate = pickTerminalForPoint(point, visible);
        const isOnTerminal = candidate !== null;
        if (!isOnTerminal) {
            // Gradually decay confidence; when EMA drops below 0.2, drop attention.
            state = {
                ...state,
                emaScore: ema(state.emaScore, 0, EMA_ALPHA_DEFAULT),
                lastUpdateMs: point.tMs,
            };
            if (state.emaScore < 0.2 && currentAttended !== null) {
                currentAttended = null;
                emitter.fire({ terminalId: null, confidence: state.emaScore });
            }
            return;
        }
        // Hit: smooth toward 1 if same terminal as last time, otherwise reset.
        if (state.terminalId === candidate) {
            state = {
                terminalId: candidate,
                emaScore: ema(state.emaScore, 1, EMA_ALPHA_DEFAULT),
                firstSeenMs: state.firstSeenMs,
                lastUpdateMs: point.tMs,
            };
        }
        else {
            state = {
                terminalId: candidate,
                emaScore: ema(0, 1, EMA_ALPHA_DEFAULT),
                firstSeenMs: point.tMs,
                lastUpdateMs: point.tMs,
            };
        }
        const dwell = state.lastUpdateMs - state.firstSeenMs;
        const meetsThreshold = dwell >= dwellMs && state.emaScore >= 0.5;
        if (meetsThreshold && currentAttended !== candidate) {
            currentAttended = candidate;
            emitter.fire({ terminalId: candidate, confidence: state.emaScore });
        }
    }
    const handle = {
        onAttention: emitter.event,
        attendedTerminalId: () => currentAttended ?? undefined,
        forward(notification) {
            if (!GAZE_POINT_METHODS.has(notification.method)) {
                return;
            }
            const point = parsePoint(notification.params, clock);
            if (!point) {
                return;
            }
            ingest(point);
        },
        ingestPointForTest(point) {
            ingest(point);
        },
        dispose() {
            emitter.dispose();
        },
    };
    context.subscriptions.push({ dispose: () => handle.dispose() });
    return handle;
}
function pickTerminalForPoint(point, visibleTerminalIds) {
    if (point.ny < TERMINAL_BAND_TOP || point.ny > TERMINAL_BAND_BOTTOM) {
        return null;
    }
    const ids = visibleTerminalIds();
    if (ids.length === 0) {
        return null;
    }
    // Approximate: divide the band horizontally into N equal slices, one per
    // visible terminal. This is the imperfect-but-good-enough mapping called
    // out in the spec — gaze rarely needs sub-pixel accuracy to pick "which
    // terminal".
    const idx = Math.min(ids.length - 1, Math.max(0, Math.floor(point.nx * ids.length)));
    return ids[idx] ?? null;
}
function defaultVisibleTerminalIds(listTerminals) {
    return listTerminals().map((t) => {
        const opts = t._id;
        return typeof opts === "string" ? opts : `terminal::${t.name ?? "anon"}`;
    });
}
function ema(prev, next, alpha) {
    return prev + (next - prev) * alpha;
}
function isGazeTargetingEnabled() {
    return vscode.workspace
        .getConfiguration("eri.terminals")
        .get("gazeTargeting", true);
}
function readDwellMs() {
    const raw = vscode.workspace
        .getConfiguration("eri.terminals")
        .get("gazeDwellMs", DEFAULT_DWELL_MS);
    if (!Number.isFinite(raw)) {
        return DEFAULT_DWELL_MS;
    }
    return Math.min(MAX_DWELL_MS, Math.max(MIN_DWELL_MS, Math.floor(raw)));
}
function parsePoint(raw, clock) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const params = raw;
    // Accept either normalized {nx, ny} or {x, y} in [0, 1].
    const nx = pickNumber(params.nx ?? params.x);
    const ny = pickNumber(params.ny ?? params.y);
    if (nx === null || ny === null) {
        return null;
    }
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) {
        return null;
    }
    const tMs = pickNumber(params.tMs) ?? clock();
    return { nx, ny, tMs };
}
function pickNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    return null;
}
//# sourceMappingURL=gaze.js.map