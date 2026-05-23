"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateTab = activateTab;
const vscode = require("vscode");
const acceptHandler_1 = require("./acceptHandler");
const DEBOUNCE_MS = 150;
class DebounceGate {
    timer = null;
    wait(token) {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        return new Promise((resolve) => {
            const onCancel = token.onCancellationRequested(() => {
                if (this.timer) {
                    clearTimeout(this.timer);
                    this.timer = null;
                }
                onCancel.dispose();
                resolve(false);
            });
            this.timer = setTimeout(() => {
                this.timer = null;
                onCancel.dispose();
                resolve(true);
            }, DEBOUNCE_MS);
        });
    }
}
class EriTabProvider {
    sidecarRef;
    gate = new DebounceGate();
    constructor(sidecarRef) {
        this.sidecarRef = sidecarRef;
    }
    async provideInlineCompletionItems(document, position, _context, token) {
        const config = vscode.workspace.getConfiguration("eri.tab");
        if (!config.get("enabled", true)) {
            return null;
        }
        const minPrefix = config.get("minPrefixLength", 2);
        const model = config.get("model", "qwen2.5-coder:1.5b");
        const maxTokens = config.get("maxTokens", 64);
        const baseUrl = config.get("baseUrl", "http://localhost:11434");
        const sidecar = this.sidecarRef();
        if (!sidecar) {
            return null;
        }
        const prefixRange = new vscode.Range(new vscode.Position(0, 0), position);
        const prefix = document.getText(prefixRange);
        if (prefix.length < minPrefix) {
            return null;
        }
        const lastLine = document.lineAt(document.lineCount - 1);
        const suffixRange = new vscode.Range(position, lastLine.range.end);
        const suffix = document.getText(suffixRange);
        const proceed = await this.gate.wait(token);
        if (!proceed || token.isCancellationRequested) {
            return null;
        }
        const params = {
            filePath: document.uri.fsPath,
            prefix,
            suffix,
            language: document.languageId,
            maxTokens,
            model,
            baseUrl,
        };
        let result;
        try {
            result = await sidecar.request("eri/tab/complete", params);
        }
        catch (err) {
            void err;
            return null;
        }
        if (token.isCancellationRequested) {
            return null;
        }
        const insertText = result?.text;
        if (typeof insertText !== "string" || insertText.length === 0) {
            return null;
        }
        const range = new vscode.Range(position, position);
        const item = {
            insertText,
            range,
        };
        return { items: [item] };
    }
}
async function runHealthCheck(sidecarRef) {
    const sidecar = sidecarRef();
    if (!sidecar) {
        void vscode.window.showWarningMessage("eri: sidecar not running");
        return;
    }
    const config = vscode.workspace.getConfiguration("eri.tab");
    const model = config.get("model", "qwen2.5-coder:1.5b");
    const baseUrl = config.get("baseUrl", "http://localhost:11434");
    try {
        const result = await sidecar.request("eri/tab/health", {
            model,
            baseUrl,
        });
        if (result?.ok === true) {
            void vscode.window.showInformationMessage(`eri tab: Ollama reachable at ${result.baseUrl ?? baseUrl} (model ${result.model ?? model})`);
        }
        else {
            void vscode.window.showWarningMessage(`eri tab: Ollama not reachable at ${result?.baseUrl ?? baseUrl}`);
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        void vscode.window.showErrorMessage(`eri tab health check failed: ${msg}`);
    }
}
function activateTab(context, sidecarRef) {
    const provider = new EriTabProvider(sidecarRef);
    const selector = { scheme: "file" };
    context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider(selector, provider), vscode.commands.registerCommand("eri.tab.health", () => runHealthCheck(sidecarRef)));
    (0, acceptHandler_1.registerAcceptHandlers)(context);
}
//# sourceMappingURL=tab.js.map