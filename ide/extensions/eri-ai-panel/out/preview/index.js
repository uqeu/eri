"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activatePreview = activatePreview;
const path = require("path");
const vscode = require("vscode");
const previewClient_1 = require("./previewClient");
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
function activatePreview(context, getSidecar) {
    const client = new previewClient_1.PreviewClient(getSidecar);
    const shouldOpenEmitter = new vscode.EventEmitter();
    let lastUrl = null;
    const openShouldOpenSub = shouldOpenEmitter.event(async (url) => {
        try {
            await client.open(url, resolveConfiguredBinary());
            lastUrl = url;
        }
        catch (err) {
            vscode.window.showWarningMessage(`eri preview — open failed: ${getErrorMessage(err)}`);
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
        }
        catch (err) {
            vscode.window.showErrorMessage(`eri preview — open failed: ${getErrorMessage(err)}`);
        }
    });
    const closeCmd = vscode.commands.registerCommand("eri.preview.close", async () => {
        try {
            await client.close();
        }
        catch (err) {
            vscode.window.showWarningMessage(`eri preview — close failed: ${getErrorMessage(err)}`);
        }
    });
    const reloadCmd = vscode.commands.registerCommand("eri.preview.reload", async () => {
        try {
            await client.reload();
        }
        catch (err) {
            vscode.window.showWarningMessage(`eri preview — reload failed: ${getErrorMessage(err)}`);
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
            .get("autoOpen", true);
        if (!autoOpen) {
            return;
        }
        const sidecar = getSidecar();
        if (!sidecar) {
            return;
        }
        try {
            const report = await sidecar.request("eri/preview/discover", {});
            if (report.detectedUrl) {
                shouldOpenEmitter.fire(report.detectedUrl);
            }
        }
        catch {
            // Silent — discover is best-effort.
        }
    }, 2_000);
    context.subscriptions.push(openCmd, closeCmd, reloadCmd, openShouldOpenSub, shouldOpenEmitter, {
        dispose: () => {
            clearInterval(statusInterval);
            clearTimeout(autoOpenTimer);
        },
    });
    const handle = {
        client,
        onShouldOpen: shouldOpenEmitter.event,
        fireShouldOpen(url) {
            shouldOpenEmitter.fire(url);
        },
        status() {
            return client.status();
        },
        dispose() {
            clearInterval(statusInterval);
            shouldOpenEmitter.dispose();
            void client.close().catch(() => undefined);
        },
    };
    context.subscriptions.push({ dispose: () => handle.dispose() });
    return handle;
}
async function pickInitialUrl(lastUrl) {
    const folders = vscode.workspace.workspaceFolders;
    const candidate = folders && folders[0]
        ? path.join(folders[0].uri.fsPath, "index.html")
        : null;
    let placeholder;
    if (lastUrl) {
        placeholder = lastUrl;
    }
    else if (candidate) {
        placeholder = vscode.Uri.file(candidate).toString();
    }
    else {
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
function normalizeUrlInput(input) {
    const trimmed = input.trim();
    if (trimmed.startsWith("file://") ||
        trimmed.startsWith("http://") ||
        trimmed.startsWith("https://")) {
        return trimmed;
    }
    // Treat as a filesystem path. Make it a file:// URL so the Swift binary
    // doesn't have to guess.
    return vscode.Uri.file(trimmed).toString();
}
function resolveConfiguredBinary() {
    const value = vscode.workspace
        .getConfiguration("eri.preview")
        .get("binaryPath", "");
    if (!value || value.trim() === "") {
        return undefined;
    }
    return value;
}
function getErrorMessage(err) {
    if (err instanceof Error) {
        return err.message;
    }
    return "Unknown error";
}
//# sourceMappingURL=index.js.map