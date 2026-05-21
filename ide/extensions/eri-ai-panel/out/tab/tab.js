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
function toRange(range, fallback) {
    if (!range) {
        return fallback;
    }
    try {
        return new vscode.Range(new vscode.Position(range.start.line, range.start.character), new vscode.Position(range.end.line, range.end.character));
    }
    catch {
        return fallback;
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
        const modelOverride = config.get("modelOverride", "");
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
            uri: document.uri.toString(),
            languageId: document.languageId,
            prefix,
            suffix,
            cursor: { line: position.line, character: position.character },
        };
        if (modelOverride && modelOverride.trim().length > 0) {
            params.modelOverride = modelOverride;
        }
        let result;
        try {
            result = await sidecar.request("eri/tab/suggest", params);
        }
        catch (err) {
            console.debug("[eri.tab] suggest request failed", err);
            return null;
        }
        if (token.isCancellationRequested) {
            return null;
        }
        const insertText = result?.insertText;
        if (typeof insertText !== "string" || insertText.length === 0) {
            return null;
        }
        const fallbackRange = new vscode.Range(position, position);
        const range = toRange(result.range, fallbackRange);
        const item = {
            insertText,
            range,
        };
        return { items: [item] };
    }
}
function activateTab(context, sidecarRef) {
    const provider = new EriTabProvider(sidecarRef);
    const selector = { scheme: "file" };
    context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider(selector, provider));
    (0, acceptHandler_1.registerAcceptHandlers)(context);
}
//# sourceMappingURL=tab.js.map