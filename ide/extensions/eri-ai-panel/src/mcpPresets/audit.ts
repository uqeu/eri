// Append-only local audit log for MCP preset operations.
// Lives at <workspace>/.eri/audit.log. Never sent off-machine.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export interface AuditEntry {
  readonly kind: "mcp_install" | "mcp_uninstall" | "mcp_configure";
  readonly server_id: string;
  readonly time_ms: number;
  readonly requires_keys: ReadonlyArray<string>;
}

function resolveAuditDir(): string | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return null;
  }
  return path.join(folder.uri.fsPath, ".eri");
}

export async function writeAuditEntry(entry: AuditEntry): Promise<void> {
  const dir = resolveAuditDir();
  if (!dir) {
    return;
  }
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch {
    // Best-effort — if we can't create the dir we silently skip the audit
    // entry rather than blocking the install.
    return;
  }
  const line = `${JSON.stringify(entry)}\n`;
  try {
    await fs.promises.appendFile(path.join(dir, "audit.log"), line, "utf8");
  } catch {
    // Audit failures must never block the user-visible install path.
  }
}
