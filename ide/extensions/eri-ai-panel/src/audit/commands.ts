import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { AuditEntry, AuditStatus, AuditTreeDataProvider } from "./view";

const RECENT_LIMIT = 200;

interface RawEntry {
  at_ms?: unknown;
  kind?: unknown;
  method?: unknown;
  workspace?: unknown;
  status?: unknown;
  duration_ms?: unknown;
  metadata?: unknown;
}

interface RecentResult {
  entries?: ReadonlyArray<unknown>;
}

interface StatusResult {
  enabled?: unknown;
  path?: unknown;
  sizeBytes?: unknown;
  rotations?: unknown;
  dropped?: unknown;
}

interface EnableResult {
  ok?: unknown;
}

export interface AuditCommandsHandle {
  refresh(): Promise<void>;
}

export function registerAuditCommands(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
  provider: AuditTreeDataProvider,
): AuditCommandsHandle {
  const refresh = async (): Promise<void> => {
    const sidecar = getSidecar();
    if (!sidecar) {
      provider.setError("Sidecar not running.");
      return;
    }
    try {
      const status = await sidecar.request<StatusResult>("eri/audit/status", {});
      provider.setStatus(parseStatus(status));
    } catch (err: unknown) {
      provider.setError(`Failed to load audit status: ${errorMessage(err)}`);
      return;
    }
    try {
      const recent = await sidecar.request<RecentResult>("eri/audit/recent", {
        limit: RECENT_LIMIT,
      });
      provider.setEntries(parseEntries(recent?.entries));
    } catch (err: unknown) {
      provider.setError(`Failed to load audit entries: ${errorMessage(err)}`);
    }
  };

  const enableCmd = vscode.commands.registerCommand(
    "eri.audit.enable",
    async () => {
      const sidecar = getSidecar();
      if (!sidecar) {
        vscode.window.showWarningMessage("eri sidecar is not running.");
        return;
      }
      try {
        await sidecar.request<EnableResult>("eri/audit/enable", {});
        vscode.window.showInformationMessage("eri audit log enabled.");
        await refresh();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `Failed to enable audit: ${errorMessage(err)}`,
        );
      }
    },
  );

  const disableCmd = vscode.commands.registerCommand(
    "eri.audit.disable",
    async () => {
      const sidecar = getSidecar();
      if (!sidecar) {
        vscode.window.showWarningMessage("eri sidecar is not running.");
        return;
      }
      try {
        await sidecar.request<EnableResult>("eri/audit/disable", {});
        vscode.window.showInformationMessage("eri audit log disabled.");
        await refresh();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `Failed to disable audit: ${errorMessage(err)}`,
        );
      }
    },
  );

  const openFileCmd = vscode.commands.registerCommand(
    "eri.audit.openFile",
    async () => {
      const sidecar = getSidecar();
      if (!sidecar) {
        vscode.window.showWarningMessage("eri sidecar is not running.");
        return;
      }
      try {
        const status = await sidecar.request<StatusResult>(
          "eri/audit/status",
          {},
        );
        const parsed = parseStatus(status);
        if (!parsed.path) {
          vscode.window.showWarningMessage("audit log path is empty.");
          return;
        }
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(parsed.path),
        );
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err: unknown) {
        vscode.window.showWarningMessage(
          `Audit log not available: ${errorMessage(err)}`,
        );
      }
    },
  );

  const refreshCmd = vscode.commands.registerCommand(
    "eri.audit.refresh",
    refresh,
  );

  const showEntryCmd = vscode.commands.registerCommand(
    "eri.audit.showEntry",
    async (entry: AuditEntry | undefined) => {
      if (!entry) {
        return;
      }
      const json = JSON.stringify(
        {
          at: new Date(entry.at_ms).toISOString(),
          kind: entry.kind,
          method: entry.method,
          status: entry.status,
          duration_ms: entry.duration_ms,
          workspace: entry.workspace,
          metadata: entry.metadata,
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
    enableCmd,
    disableCmd,
    openFileCmd,
    refreshCmd,
    showEntryCmd,
  );

  return { refresh };
}

function parseStatus(raw: StatusResult | undefined | null): AuditStatus {
  return {
    enabled: typeof raw?.enabled === "boolean" ? raw.enabled : false,
    path: typeof raw?.path === "string" ? raw.path : "",
    sizeBytes: typeof raw?.sizeBytes === "number" ? raw.sizeBytes : 0,
    rotations: typeof raw?.rotations === "number" ? raw.rotations : 0,
    dropped: typeof raw?.dropped === "number" ? raw.dropped : 0,
  };
}

function parseEntries(
  raw: ReadonlyArray<unknown> | undefined,
): ReadonlyArray<AuditEntry> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: AuditEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const obj = entry as RawEntry;
    const kind = typeof obj.kind === "string" ? obj.kind : null;
    const at_ms = typeof obj.at_ms === "number" ? obj.at_ms : null;
    const statusRaw = typeof obj.status === "string" ? obj.status : null;
    if (!kind || at_ms === null || !isStatus(statusRaw)) {
      continue;
    }
    out.push({
      at_ms,
      kind,
      method: typeof obj.method === "string" ? obj.method : undefined,
      workspace:
        typeof obj.workspace === "string" ? obj.workspace : undefined,
      status: statusRaw,
      duration_ms:
        typeof obj.duration_ms === "number" ? obj.duration_ms : undefined,
      metadata: obj.metadata,
      raw: JSON.stringify(entry),
    });
  }
  // Most-recent first.
  out.sort((a, b) => b.at_ms - a.at_ms);
  return out;
}

function isStatus(value: string | null): value is AuditEntry["status"] {
  return value === "ok" || value === "error" || value === "skipped";
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
