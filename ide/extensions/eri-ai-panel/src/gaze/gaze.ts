import * as vscode from "vscode";
import { Sidecar, SidecarNotification } from "../sidecar";
import { GazeDecoration } from "./gazeDecoration";
import { GazeStatusBar } from "./gazeStatusBar";

export type GazeTargetKind = "editor" | "panel" | "preview";

export interface GazeTarget {
  kind: GazeTargetKind;
  // Only meaningful when kind === "editor".
  line?: number;
  column?: number;
  // Only meaningful when kind === "panel" | "preview".
  elementId?: string;
  // Set automatically when we receive an editor target so downstream consumers
  // can resolve the document without recalculating from the active editor.
  uri?: string;
  receivedAt: number;
}

export interface GazeHandle {
  getCurrentTarget(): GazeTarget | null;
  forward(notification: SidecarNotification): void;
  isEnabled(): boolean;
  dispose(): void;
}

// Module-level state so other features (composer, mentions, inline-edit) can
// read the gaze target via the exported getCurrentTarget() without threading
// the handle through every constructor.
let currentTarget: GazeTarget | null = null;

export function getCurrentTarget(): GazeTarget | null {
  return currentTarget;
}

const GAZE_METHODS = new Set([
  "eri/gaze/target",
  "eri/gaze/lost",
  "eri/gaze/calibration/required",
]);

export function activateGaze(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
): GazeHandle {
  const decoration = new GazeDecoration();
  const statusBar = new GazeStatusBar();

  const editorChangeSub = vscode.window.onDidChangeActiveTextEditor(() => {
    decoration.refreshForActiveEditor();
  });

  const configChangeSub = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("eri.gaze.enabled")) {
      if (!isFeatureEnabled()) {
        currentTarget = null;
        decoration.clear();
        statusBar.hide();
      } else {
        statusBar.show();
      }
    }
    if (event.affectsConfiguration("eri.gaze.decorationsEnabled")) {
      // Reapply current line so toggling the setting reflects immediately.
      if (currentTarget?.kind === "editor" && typeof currentTarget.line === "number") {
        decoration.showLine(currentTarget.line);
      } else {
        decoration.clear();
      }
    }
  });

  const recalibrateCmd = vscode.commands.registerCommand("eri.gaze.recalibrate", () => {
    const sidecar = getSidecar();
    if (!sidecar) {
      vscode.window.showWarningMessage("eri gaze — sidecar offline, can't recalibrate");
      return;
    }
    sidecar.notify("eri/gaze/recalibrate", {});
    vscode.window.setStatusBarMessage("eri gaze — recalibration requested", 2000);
  });

  const toggleCmd = vscode.commands.registerCommand("eri.gaze.toggle", async () => {
    const config = vscode.workspace.getConfiguration("eri.gaze");
    const next = !config.get<boolean>("enabled", true);
    await config.update("enabled", next, vscode.ConfigurationTarget.Global);
    vscode.window.setStatusBarMessage(
      `eri gaze — ${next ? "enabled" : "disabled"}`,
      2000,
    );
  });

  context.subscriptions.push(editorChangeSub, configChangeSub, recalibrateCmd, toggleCmd);

  if (!isFeatureEnabled()) {
    statusBar.hide();
  }

  const handle: GazeHandle = {
    getCurrentTarget: () => currentTarget,
    isEnabled: isFeatureEnabled,
    forward(notification: SidecarNotification): void {
      if (!GAZE_METHODS.has(notification.method)) {
        return;
      }
      if (!isFeatureEnabled()) {
        return;
      }
      handleGazeNotification(notification, decoration, statusBar);
    },
    dispose(): void {
      decoration.dispose();
      statusBar.dispose();
      currentTarget = null;
    },
  };

  context.subscriptions.push({ dispose: () => handle.dispose() });

  return handle;
}

function handleGazeNotification(
  notification: SidecarNotification,
  decoration: GazeDecoration,
  statusBar: GazeStatusBar,
): void {
  switch (notification.method) {
    case "eri/gaze/target": {
      const target = parseTarget(notification.params);
      if (!target) {
        return;
      }
      currentTarget = target;
      statusBar.setState("looking");
      if (target.kind === "editor" && typeof target.line === "number") {
        decoration.showLine(target.line);
      } else {
        decoration.clear();
      }
      break;
    }
    case "eri/gaze/lost":
      currentTarget = null;
      decoration.clear();
      statusBar.setState("lost");
      break;
    case "eri/gaze/calibration/required":
      currentTarget = null;
      decoration.clear();
      statusBar.setState("calibration");
      break;
    default:
      break;
  }
}

// Validate at the boundary — the sidecar protocol may evolve and a malformed
// payload should never crash the extension host.
function parseTarget(raw: unknown): GazeTarget | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const params = raw as Record<string, unknown>;
  const kind = params.kind;
  if (kind !== "editor" && kind !== "panel" && kind !== "preview") {
    return null;
  }
  const target: GazeTarget = {
    kind,
    receivedAt: Date.now(),
  };
  if (typeof params.line === "number" && Number.isFinite(params.line) && params.line >= 0) {
    target.line = Math.floor(params.line);
  }
  if (typeof params.column === "number" && Number.isFinite(params.column) && params.column >= 0) {
    target.column = Math.floor(params.column);
  }
  if (typeof params.elementId === "string") {
    target.elementId = params.elementId;
  }
  if (typeof params.uri === "string") {
    target.uri = params.uri;
  } else if (kind === "editor") {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      target.uri = editor.document.uri.toString();
    }
  }
  return target;
}

function isFeatureEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("eri.gaze")
    .get<boolean>("enabled", true);
}

// Convenience helper for downstream features. Returns the resolved document
// position when gaze is on the editor, otherwise null. Honors the configurable
// contextRadius so callers can ask "what lines should I include around the
// gaze point" without re-reading settings.
export function getEditorGazeContext(): {
  uri: string;
  line: number;
  column: number;
  radius: number;
} | null {
  if (!currentTarget || currentTarget.kind !== "editor") {
    return null;
  }
  if (typeof currentTarget.line !== "number") {
    return null;
  }
  const uri = currentTarget.uri ?? vscode.window.activeTextEditor?.document.uri.toString();
  if (!uri) {
    return null;
  }
  const radius = vscode.workspace
    .getConfiguration("eri.gaze")
    .get<number>("contextRadius", 5);
  return {
    uri,
    line: currentTarget.line,
    column: currentTarget.column ?? 0,
    radius: Math.max(0, Math.floor(radius)),
  };
}
