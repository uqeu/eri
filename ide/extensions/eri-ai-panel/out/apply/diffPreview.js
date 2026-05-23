"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openDiff = openDiff;
const vscode = require("vscode");
const os = require("os");
const path = require("path");
const fs = require("fs/promises");
// Open a side-by-side diff between the current on-disk file and the
// post-edit "after" buffer from the orchestrator's preview. The "after"
// buffer is written to a temp file because vscode.diff requires URIs;
// we keep the file extension stable so syntax highlighting is preserved.
async function openDiff(edit) {
    const beforeUri = vscode.Uri.file(edit.absolutePath);
    if (!edit.preview.hasPreview) {
        const message = edit.preview.reason ?? "No preview available for this edit.";
        await vscode.window.showWarningMessage(message);
        await vscode.window.showTextDocument(beforeUri, { preview: true });
        return;
    }
    const ext = path.extname(edit.path);
    const base = path.basename(edit.path, ext);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "eri-apply-"));
    const tmpPath = path.join(tmpDir, `${base}.proposed${ext}`);
    await fs.writeFile(tmpPath, edit.preview.after, "utf8");
    const afterUri = vscode.Uri.file(tmpPath);
    const title = `${edit.path} (current ↔ proposed)`;
    await vscode.commands.executeCommand("vscode.diff", beforeUri, afterUri, title);
}
//# sourceMappingURL=diffPreview.js.map