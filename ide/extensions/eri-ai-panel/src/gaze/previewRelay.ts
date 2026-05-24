import { Sidecar } from "../sidecar";
import { GazePoint, GazeService } from "./gazeService";

const MAX_HZ = 30;
const MIN_INTERVAL_MS = Math.floor(1000 / MAX_HZ);

/// Forwards gaze samples to the Swift preview window via the sidecar's
/// `eri/preview/gaze` JSON-RPC method. Heavy throttle (30 Hz max).
/// Stops silently when the preview window is not running.
export class PreviewRelay {
  private readonly subscription: { dispose: () => void };
  private lastRelayAt = 0;

  constructor(
    private readonly service: GazeService,
    private readonly getSidecar: () => Sidecar | null,
  ) {
    this.subscription = this.service.onGaze((point) => this.handlePoint(point));
  }

  private isEnabled(): boolean {
    const config = (globalThis as { vscode?: typeof import("vscode") }).vscode;
    // The unit tests stub `vscode`; access defensively.
    if (!config?.workspace) {
      return true;
    }
    return config.workspace
      .getConfiguration("eri.gaze")
      .get<boolean>("previewRelay", true);
  }

  private handlePoint(point: GazePoint): void {
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

  dispose(): void {
    this.subscription.dispose();
  }
}

/// Pure throttle helper exposed for tests.
export class Throttle {
  private last: number | null = null;

  constructor(private readonly minIntervalMs: number) {}

  tick(now: number): boolean {
    if (this.last !== null && now - this.last < this.minIntervalMs) {
      return false;
    }
    this.last = now;
    return true;
  }
}
