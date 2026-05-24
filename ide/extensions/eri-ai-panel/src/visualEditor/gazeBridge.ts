// Gaze fusion for the Visual Editor.
//
// The sidecar reports gaze points relative to the screen. When the Visual
// Editor panel is visible we approximate iframe-relative coords by tracking
// dwell time and relaying the point to the shim so it can hit-test against
// the live DOM. After `dwellMs` of stable dwell on the same element the shim
// auto-picks - saving the user a manual click.

import { ShimInbound } from "./pickerBridge";

export interface GazeBridgeDeps {
  readonly isPanelActive: () => boolean;
  readonly relayToShim: (message: ShimInbound) => void;
  readonly getDwellMs: () => number;
  readonly showStatus: (text: string, tone?: "info" | "warn" | "error") => void;
}

export interface GazePoint {
  // Normalized webview-relative coords (0-1). The sidecar reports either
  // pixel coords or normalized; we normalize here.
  readonly nx: number;
  readonly ny: number;
  readonly receivedAt: number;
}

export interface GazeNotification {
  readonly method: string;
  readonly params: unknown;
}

const GAZE_METHODS = new Set<string>([
  "eri/gaze/target",
  "eri/gaze/lost",
  "eri/gaze/point",
]);

// Movement tolerance (normalized units) below which we consider the gaze to
// be "stable" - i.e. dwelling on the same element.
const STABILITY_THRESHOLD = 0.02;

export class GazeBridge {
  private lastPoint: GazePoint | null = null;
  private dwellTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: GazeBridgeDeps) {}

  forward(notification: GazeNotification): void {
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

  dispose(): void {
    this.reset();
  }

  private handlePoint(point: GazePoint): void {
    const previous = this.lastPoint;
    this.lastPoint = point;

    // Always relay to shim so the highlight follows in real time.
    this.deps.relayToShim({
      kind: "highlightAtPoint",
      x: point.nx,
      y: point.ny,
    });

    if (
      !previous ||
      Math.abs(point.nx - previous.nx) > STABILITY_THRESHOLD ||
      Math.abs(point.ny - previous.ny) > STABILITY_THRESHOLD
    ) {
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

  private scheduleAutoPick(): void {
    const dwellMs = Math.max(200, Math.floor(this.deps.getDwellMs()));
    this.dwellTimer = setTimeout(() => {
      // The shim translates "pickStart" into auto-pick when it has a
      // currently-highlighted element under the gaze point.
      this.deps.relayToShim({ kind: "pickStart" });
      this.deps.showStatus("gaze-picked element", "info");
      this.dwellTimer = null;
    }, dwellMs);
  }

  private clearDwellTimer(): void {
    if (this.dwellTimer) {
      clearTimeout(this.dwellTimer);
      this.dwellTimer = null;
    }
  }

  private reset(): void {
    this.lastPoint = null;
    this.clearDwellTimer();
  }
}

// Parse the sidecar gaze payload. Accepts:
//   { nx, ny }                  - normalized 0..1
//   { x, y, width, height }     - pixel coords (we normalize)
//   { kind: "panel", elementId } - ignored (we only fuse coord-based)
function parseGazePoint(raw: unknown): GazePoint | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const receivedAt = Date.now();
  if (typeof obj.nx === "number" && typeof obj.ny === "number") {
    return {
      nx: clamp01(obj.nx),
      ny: clamp01(obj.ny),
      receivedAt,
    };
  }
  if (
    typeof obj.x === "number" &&
    typeof obj.y === "number" &&
    typeof obj.width === "number" &&
    typeof obj.height === "number" &&
    obj.width > 0 &&
    obj.height > 0
  ) {
    return {
      nx: clamp01(obj.x / obj.width),
      ny: clamp01(obj.y / obj.height),
      receivedAt,
    };
  }
  return null;
}

function clamp01(value: number): number {
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
