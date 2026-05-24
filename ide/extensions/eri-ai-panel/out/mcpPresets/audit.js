"use strict";
// Append-only local audit log for MCP preset operations.
// Lives at <workspace>/.eri/audit.log. Never sent off-machine.
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeAuditEntry = writeAuditEntry;
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
function resolveAuditDir() {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        return null;
    }
    return path.join(folder.uri.fsPath, ".eri");
}
async function writeAuditEntry(entry) {
    const dir = resolveAuditDir();
    if (!dir) {
        return;
    }
    try {
        await fs.promises.mkdir(dir, { recursive: true });
    }
    catch {
        // Best-effort — if we can't create the dir we silently skip the audit
        // entry rather than blocking the install.
        return;
    }
    const line = `${JSON.stringify(entry)}\n`;
    try {
        await fs.promises.appendFile(path.join(dir, "audit.log"), line, "utf8");
    }
    catch {
        // Audit failures must never block the user-visible install path.
    }
}
//# sourceMappingURL=audit.js.map