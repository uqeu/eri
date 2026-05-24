import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { CrashEntry, CrashTreeDataProvider } from "./view";

const RECENT_LIMIT = 200;

interface RawEntry {
  at_ms?: unknown;
  kind?: unknown;
  message?: unknown;
  thread?: unknown;
  location?: unknown;
  backtrace?: unknown;
}

interface RecentResult {
  entries?: ReadonlyArray<unknown>;
}

interface SentryStatusResult {
  enabled?: unknown;
  dsnSet?: unknown;
  featureCompiled?: unknown;
}

interface OkResult {
  ok?: unknown;
}

export interface CrashCommandsHandle {
  refresh(): Promise<void>;
}

export function registerCrashCommands(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
  provider: CrashTreeDataProvider,
): CrashCommandsHandle {
  const refresh = async (): Promise<void> => {
    const sidecar = getSidecar();
    if (!sidecar) {
      provider.setError("Sidecar not running.");
      return;
    }
    try {
      const result = await sidecar.request<RecentResult>("eri/crash/recent", {
        limit: RECENT_LIMIT,
      });
      provider.setEntries(parseEntries(result?.entries));
    } catch (err: unknown) {
      provider.setError(`Failed to load crashes: ${errorMessage(err)}`);
    }
  };

  const refreshCmd = vscode.commands.registerCommand(
    "eri.crash.refresh",
    refresh,
  );

  const openLogCmd = vscode.commands.registerCommand(
    "eri.crash.openLog",
    async () => {
      const sidecar = getSidecar();
      if (!sidecar) {
        vscode.window.showWarningMessage("eri sidecar is not running.");
        return;
      }
      try {
        const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const path = workspace
          ? `${workspace}/.eri/crash.log`
          : `${home}/.eri/crash.log`;
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(path),
        );
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err: unknown) {
        vscode.window.showWarningMessage(
          `Crash log not available: ${errorMessage(err)}`,
        );
      }
    },
  );

  const openSidecarLogCmd = vscode.commands.registerCommand(
    "eri.crash.openSidecarLog",
    async () => {
      try {
        const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const path = workspace
          ? `${workspace}/.eri/sidecar.log`
          : `${home}/.eri/sidecar.log`;
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(path),
        );
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err: unknown) {
        vscode.window.showWarningMessage(
          `Sidecar log not available: ${errorMessage(err)}`,
        );
      }
    },
  );

  const clearCmd = vscode.commands.registerCommand(
    "eri.crash.clear",
    async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Clear the local crash log? This cannot be undone.",
        { modal: true },
        "Clear",
      );
      if (confirm !== "Clear") {
        return;
      }
      const sidecar = getSidecar();
      if (!sidecar) {
        vscode.window.showWarningMessage("eri sidecar is not running.");
        return;
      }
      try {
        await sidecar.request<OkResult>("eri/crash/clear", {});
        await refresh();
        vscode.window.showInformationMessage("Crash log cleared.");
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `Failed to clear crash log: ${errorMessage(err)}`,
        );
      }
    },
  );

  const copyLastCmd = vscode.commands.registerCommand(
    "eri.crash.copyLast",
    async () => {
      const latest = provider.latest();
      if (!latest) {
        vscode.window.showInformationMessage("No crash entries to copy.");
        return;
      }
      const text = JSON.stringify(latest, null, 2);
      await vscode.env.clipboard.writeText(text);
      vscode.window.showInformationMessage("Latest crash copied to clipboard.");
    },
  );

  const showEntryCmd = vscode.commands.registerCommand(
    "eri.crash.showEntry",
    async (entry: CrashEntry | undefined) => {
      if (!entry) {
        return;
      }
      const json = JSON.stringify(
        {
          at: new Date(entry.at_ms).toISOString(),
          kind: entry.kind,
          thread: entry.thread,
          location: entry.location,
          message: entry.message,
          backtrace: entry.backtrace,
        },
        null,
        2,
      );
      const doc = await vscode.workspace.openTextDocument({
        content: json,
        language: "json",
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    },
  );

  context.subscriptions.push(
    refreshCmd,
    openLogCmd,
    openSidecarLogCmd,
    clearCmd,
    copyLastCmd,
    showEntryCmd,
  );

  // Also export sentry-related helpers via dedicated commands for the
  // Settings Hub privacy toggle.
  const sentryEnable = vscode.commands.registerCommand(
    "eri.crash.sentryEnable",
    async (dsn?: string) => {
      const sidecar = getSidecar();
      if (!sidecar) {
        return { ok: false } as const;
      }
      try {
        const result = await sidecar.request<{ ok?: unknown; dsnSet?: unknown }>(
          "eri/sentry/enable",
          { dsn: typeof dsn === "string" ? dsn : "" },
        );
        return { ok: result?.ok === true, dsnSet: result?.dsnSet === true };
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `Failed to enable Sentry: ${errorMessage(err)}`,
        );
        return { ok: false } as const;
      }
    },
  );

  const sentryDisable = vscode.commands.registerCommand(
    "eri.crash.sentryDisable",
    async () => {
      const sidecar = getSidecar();
      if (!sidecar) {
        return { ok: false } as const;
      }
      try {
        await sidecar.request<OkResult>("eri/sentry/disable", {});
        return { ok: true } as const;
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `Failed to disable Sentry: ${errorMessage(err)}`,
        );
        return { ok: false } as const;
      }
    },
  );

  const sentryStatus = vscode.commands.registerCommand(
    "eri.crash.sentryStatus",
    async () => {
      const sidecar = getSidecar();
      if (!sidecar) {
        return null;
      }
      try {
        const result = await sidecar.request<SentryStatusResult>(
          "eri/sentry/status",
          {},
        );
        return {
          enabled: result?.enabled === true,
          dsnSet: result?.dsnSet === true,
          featureCompiled: result?.featureCompiled === true,
        };
      } catch (err: unknown) {
        console.warn(`[eri] sentry status failed: ${errorMessage(err)}`);
        return null;
      }
    },
  );

  context.subscriptions.push(sentryEnable, sentryDisable, sentryStatus);

  return { refresh };
}

function parseEntries(
  raw: ReadonlyArray<unknown> | undefined,
): ReadonlyArray<CrashEntry> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: CrashEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const obj = entry as RawEntry;
    const at_ms = typeof obj.at_ms === "number" ? obj.at_ms : null;
    const kind = typeof obj.kind === "string" ? obj.kind : null;
    const message = typeof obj.message === "string" ? obj.message : "";
    if (at_ms === null || !kind) {
      continue;
    }
    out.push({
      at_ms,
      kind,
      message,
      thread: typeof obj.thread === "string" ? obj.thread : undefined,
      location: typeof obj.location === "string" ? obj.location : undefined,
      backtrace: typeof obj.backtrace === "string" ? obj.backtrace : undefined,
    });
  }
  out.sort((a, b) => b.at_ms - a.at_ms);
  return out;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return "unknown error";
}
