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

import * as vscode from "vscode";
import { SidecarNotification } from "../sidecar";

export interface GazePoint {
  // Screen-normalized coords in [0, 1]. 0,0 is top-left.
  readonly nx: number;
  readonly ny: number;
  readonly tMs: number;
}

export interface GazeAttentionEvent {
  readonly terminalId: string | null;
  readonly confidence: number;
}

export interface TerminalGazeOptions {
  // Overrides for tests.
  readonly clockMs?: () => number;
  readonly listTerminals?: () => ReadonlyArray<vscode.Terminal>;
  // Returns ordered ids of terminals visible in the panel, top-most first.
  // When omitted we approximate using the active-terminal ordering.
  readonly visibleTerminalIds?: () => ReadonlyArray<string>;
}

export interface TerminalGazeHandle {
  readonly forward: (notification: SidecarNotification) => void;
  readonly onAttention: vscode.Event<GazeAttentionEvent>;
  readonly attendedTerminalId: () => string | undefined;
  readonly dispose: () => void;
  // Test entry-point: bypass the sidecar protocol and feed a point directly.
  readonly ingestPointForTest: (point: GazePoint) => void;
}

// Where the terminal panel lives on screen — bottom strip of the IDE.
// We can't query VS Code for the precise rect, so we model "is gaze on the
// terminal panel" as "ny is in the bottom band" when the panel is open.
const TERMINAL_BAND_TOP = 0.65;
const TERMINAL_BAND_BOTTOM = 1.0;

const EMA_ALPHA_DEFAULT = 0.35;
const MIN_DWELL_MS = 200;
const MAX_DWELL_MS = 3000;
const DEFAULT_DWELL_MS = 800;

const GAZE_POINT_METHODS = new Set<string>([
  "eri/gaze/point",
  "gaze/point",
]);

interface AttentionState {
  terminalId: string | null;
  // EMA over recent attention scores [0, 1].
  emaScore: number;
  // First time we've seen this terminalId in the current run.
  firstSeenMs: number;
  // Most recent time we updated.
  lastUpdateMs: number;
}

export function activateTerminalGaze(
  context: vscode.ExtensionContext,
  options: TerminalGazeOptions = {},
): TerminalGazeHandle {
  const clock = options.clockMs ?? (() => Date.now());
  const listTerminals =
    options.listTerminals ?? (() => vscode.window.terminals);
  const visible =
    options.visibleTerminalIds ?? (() => defaultVisibleTerminalIds(listTerminals));

  const emitter = new vscode.EventEmitter<GazeAttentionEvent>();
  let currentAttended: string | null = null;
  let state: AttentionState = {
    terminalId: null,
    emaScore: 0,
    firstSeenMs: clock(),
    lastUpdateMs: clock(),
  };

  function ingest(point: GazePoint): void {
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
    } else {
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

  const handle: TerminalGazeHandle = {
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

function pickTerminalForPoint(
  point: GazePoint,
  visibleTerminalIds: () => ReadonlyArray<string>,
): string | null {
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
  const idx = Math.min(
    ids.length - 1,
    Math.max(0, Math.floor(point.nx * ids.length)),
  );
  return ids[idx] ?? null;
}

function defaultVisibleTerminalIds(
  listTerminals: () => ReadonlyArray<vscode.Terminal>,
): ReadonlyArray<string> {
  return listTerminals().map((t) => {
    const opts = (t as unknown as { _id?: string })._id;
    return typeof opts === "string" ? opts : `terminal::${t.name ?? "anon"}`;
  });
}

function ema(prev: number, next: number, alpha: number): number {
  return prev + (next - prev) * alpha;
}

function isGazeTargetingEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("eri.terminals")
    .get<boolean>("gazeTargeting", true);
}

function readDwellMs(): number {
  const raw = vscode.workspace
    .getConfiguration("eri.terminals")
    .get<number>("gazeDwellMs", DEFAULT_DWELL_MS);
  if (!Number.isFinite(raw)) {
    return DEFAULT_DWELL_MS;
  }
  return Math.min(MAX_DWELL_MS, Math.max(MIN_DWELL_MS, Math.floor(raw)));
}

function parsePoint(raw: unknown, clock: () => number): GazePoint | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const params = raw as Record<string, unknown>;
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

function pickNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}
