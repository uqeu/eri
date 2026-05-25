import * as path from "path";
import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { PreviewClient, PreviewStatus } from "./previewClient";

export interface PreviewHandle {
  readonly client: PreviewClient;
  readonly onShouldOpen: vscode.Event<string>;
  /** Fire to ask the preview to (re)open at the given URL. */
  fireShouldOpen(url: string): void;
  status(): Promise<PreviewStatus>;
  dispose(): void;
}

/**
 * Wire up the Swift preview window control surface:
 *   * `eri.preview.open`    — prompts for URL (or uses workspace index.html)
 *   * `eri.preview.close`
 *   * `eri.preview.reload`
 *
 * Returns a handle whose `client` and `onShouldOpen` event lets other
 * modules (apply orchestrator, gaze relay) drive it without round-tripping
 * through the command palette.
 */
export function activatePreview(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
): PreviewHandle {
  const client = new PreviewClient(getSidecar);
  const shouldOpenEmitter = new vscode.EventEmitter<string>();
  let lastUrl: string | null = null;

  const openShouldOpenSub = shouldOpenEmitter.event(async (url) => {
    try {
      await client.open(url, resolveConfiguredBinary());
      lastUrl = url;
    } catch (err) {
      vscode.window.showWarningMessage(
        `eri preview — open failed: ${getErrorMessage(err)}`,
      );
    }
  });

  const openCmd = vscode.commands.registerCommand("eri.preview.open", async () => {
    const candidate = await pickInitialUrl(lastUrl);
    if (!candidate) {
      return;
    }
    try {
      await client.open(candidate, resolveConfiguredBinary());
      lastUrl = candidate;
    } catch (err) {
      vscode.window.showErrorMessage(`eri preview — open failed: ${getErrorMessage(err)}`);
    }
  });

  const closeCmd = vscode.commands.registerCommand("eri.preview.close", async () => {
    try {
      await client.close();
    } catch (err) {
      vscode.window.showWarningMessage(
        `eri preview — close failed: ${getErrorMessage(err)}`,
      );
    }
  });

  const reloadCmd = vscode.commands.registerCommand("eri.preview.reload", async () => {
    try {
      await client.reload();
    } catch (err) {
      vscode.window.showWarningMessage(
        `eri preview — reload failed: ${getErrorMessage(err)}`,
      );
    }
  });

  // Poll status at 1Hz so a UI surface can show running/PID without each
  // consumer running its own poller. We expose this via the handle's
  // `status()` method too — most callers just await that on demand.
  const statusInterval = setInterval(() => {
    void client.status().catch(() => undefined);
  }, 1000);

  // One-shot dev-server autodetect (Phase 10). After a short delay so the
  // sidecar has fully booted, ask the Swift side which common port is
  // already serving. If it finds one AND `eri.preview.autoOpen` is true,
  // open the preview with that URL. Silent on failure.
  const autoOpenTimer = setTimeout(async () => {
    const autoOpen = vscode.workspace
      .getConfiguration("eri.preview")
      .get<boolean>("autoOpen", true);
    if (!autoOpen) {
      return;
    }
    const sidecar = getSidecar();
    if (!sidecar) {
      return;
    }
    try {
      const report = await sidecar.request<{ detectedUrl?: string | null }>(
        "eri/preview/discover",
        {},
      );
      if (report.detectedUrl) {
        shouldOpenEmitter.fire(report.detectedUrl);
      }
    } catch {
      // Silent — discover is best-effort.
    }
  }, 2_000);

  context.subscriptions.push(
    openCmd,
    closeCmd,
    reloadCmd,
    openShouldOpenSub,
    shouldOpenEmitter,
    {
      dispose: () => {
        clearInterval(statusInterval);
        clearTimeout(autoOpenTimer);
      },
    },
  );

  const handle: PreviewHandle = {
    client,
    onShouldOpen: shouldOpenEmitter.event,
    fireShouldOpen(url: string): void {
      shouldOpenEmitter.fire(url);
    },
    status(): Promise<PreviewStatus> {
      return client.status();
    },
    dispose(): void {
      clearInterval(statusInterval);
      shouldOpenEmitter.dispose();
      void client.close().catch(() => undefined);
    },
  };

  context.subscriptions.push({ dispose: () => handle.dispose() });
  return handle;
}

async function pickInitialUrl(lastUrl: string | null): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  const candidate = folders && folders[0]
    ? path.join(folders[0].uri.fsPath, "index.html")
    : null;
  let placeholder: string;
  if (lastUrl) {
    placeholder = lastUrl;
  } else if (candidate) {
    placeholder = vscode.Uri.file(candidate).toString();
  } else {
    placeholder = "https://localhost:3000";
  }
  const answer = await vscode.window.showInputBox({
    prompt: "Preview URL or file path",
    value: placeholder,
    ignoreFocusOut: true,
  });
  if (!answer) {
    return undefined;
  }
  return normalizeUrlInput(answer);
}

function normalizeUrlInput(input: string): string {
  const trimmed = input.trim();
  if (
    trimmed.startsWith("file://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://")
  ) {
    return trimmed;
  }
  // Treat as a filesystem path. Make it a file:// URL so the Swift binary
  // doesn't have to guess.
  return vscode.Uri.file(trimmed).toString();
}

function resolveConfiguredBinary(): string | undefined {
  const value = vscode.workspace
    .getConfiguration("eri.preview")
    .get<string>("binaryPath", "");
  if (!value || value.trim() === "") {
    return undefined;
  }
  return value;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return "Unknown error";
}
