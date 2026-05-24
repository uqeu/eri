import { Sidecar } from "../sidecar";

export interface PreviewStatus {
  readonly running: boolean;
  readonly pid?: number;
  readonly lastUrl?: string;
}

interface RawPreviewStatus {
  running?: boolean;
  pid?: number;
  lastUrl?: string;
}

/**
 * Thin client over the sidecar's `eri/preview/*` JSON-RPC surface. All
 * methods are no-ops when the sidecar is offline so callers can fire-and-
 * forget without try/catch noise.
 */
export class PreviewClient {
  constructor(private readonly getSidecar: () => Sidecar | null) {}

  async open(url?: string, binaryPath?: string): Promise<PreviewStatus | null> {
    const sidecar = this.getSidecar();
    if (!sidecar) {
      return null;
    }
    const params: Record<string, string> = {};
    if (url !== undefined && url !== "") {
      params.url = url;
    }
    if (binaryPath !== undefined && binaryPath !== "") {
      params.binaryPath = binaryPath;
    }
    const raw = await sidecar.request<RawPreviewStatus>("eri/preview/open", params);
    return normalizeStatus(raw);
  }

  async close(): Promise<void> {
    const sidecar = this.getSidecar();
    if (!sidecar) {
      return;
    }
    await sidecar.request("eri/preview/close", {});
  }

  async reload(): Promise<void> {
    const sidecar = this.getSidecar();
    if (!sidecar) {
      return;
    }
    await sidecar.request("eri/preview/reload", {});
  }

  async load(url: string): Promise<void> {
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
  relayGaze(x: number, y: number): void {
    const sidecar = this.getSidecar();
    if (!sidecar) {
      return;
    }
    // Fire-and-forget. The sidecar handler is intentionally lenient.
    sidecar.notify("eri/preview/gaze", { x, y });
  }

  async status(): Promise<PreviewStatus> {
    const sidecar = this.getSidecar();
    if (!sidecar) {
      return { running: false };
    }
    const raw = await sidecar.request<RawPreviewStatus>("eri/preview/status", {});
    return normalizeStatus(raw);
  }
}

function normalizeStatus(raw: RawPreviewStatus | null | undefined): PreviewStatus {
  if (!raw || typeof raw !== "object") {
    return { running: false };
  }
  const status: PreviewStatus = {
    running: raw.running === true,
    ...(typeof raw.pid === "number" ? { pid: raw.pid } : {}),
    ...(typeof raw.lastUrl === "string" ? { lastUrl: raw.lastUrl } : {}),
  };
  return status;
}
