"use strict";
// BYOK settings WebviewView — renders the provider list with set/unset status
// and Add/Edit/Remove actions. All secrets are entered via
// `vscode.window.showInputBox({ password: true })`. The webview never sees the
// secret value.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ByokSettingsView = exports.BYOK_VIEW_ID = void 0;
const fs = require("fs");
const vscode = require("vscode");
const providers_1 = require("./providers");
exports.BYOK_VIEW_ID = "eri.byok";
class ByokSettingsView {
    context;
    secrets;
    view = null;
    constructor(context, secrets) {
        this.context = context;
        this.secrets = secrets;
    }
    resolveWebviewView(view) {
        this.view = view;
        view.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, "media", "byok"),
            ],
        };
        view.webview.html = this.loadHtml();
        view.webview.onDidReceiveMessage((raw) => {
            void this.handleMessage(raw);
        });
        view.onDidDispose(() => {
            this.view = null;
        });
    }
    async refresh() {
        if (!this.view) {
            return;
        }
        const state = await this.buildState();
        await this.view.webview.postMessage({ type: "state", state });
    }
    reveal() {
        this.view?.show?.(true);
    }
    async promptAndStore(providerId, fieldKey) {
        const provider = (0, providers_1.getProvider)(providerId);
        const field = (0, providers_1.getProviderField)(providerId, fieldKey);
        if (!provider || !field) {
            return false;
        }
        const value = await vscode.window.showInputBox({
            title: `${provider.displayName} — ${field.label}`,
            prompt: `Enter ${field.label} for ${provider.displayName}`,
            placeHolder: field.placeholder,
            password: field.kind === "password",
            ignoreFocusOut: true,
            validateInput: (input) => {
                if (!field.validator) {
                    return null;
                }
                return field.validator(input);
            },
        });
        if (typeof value !== "string" || value.length === 0) {
            return false;
        }
        await this.secrets.set(providerId, fieldKey, value);
        await this.refresh();
        return true;
    }
    async removeField(providerId, fieldKey) {
        const provider = (0, providers_1.getProvider)(providerId);
        const field = (0, providers_1.getProviderField)(providerId, fieldKey);
        if (!provider || !field) {
            return;
        }
        const confirm = await vscode.window.showWarningMessage(`Remove ${field.label} for ${provider.displayName}?`, { modal: true }, "Remove");
        if (confirm !== "Remove") {
            return;
        }
        await this.secrets.clear(providerId, fieldKey);
        await this.refresh();
    }
    async clearAll() {
        const confirmation = await vscode.window.showInputBox({
            title: "Clear ALL stored API keys",
            prompt: 'Type "clear" to confirm removing every stored key.',
            placeHolder: "clear",
            ignoreFocusOut: true,
        });
        if (confirmation !== "clear") {
            return;
        }
        await this.secrets.clearAll();
        await this.refresh();
        void vscode.window.showInformationMessage("eri: all stored API keys cleared.");
    }
    async pickAndSet() {
        const providerPick = await vscode.window.showQuickPick(providers_1.PROVIDERS.map((provider) => ({
            label: provider.displayName,
            description: provider.id,
            provider,
        })), { title: "Select provider", ignoreFocusOut: true });
        if (!providerPick) {
            return;
        }
        const fieldPick = providerPick.provider.fields.length === 1
            ? providerPick.provider.fields[0]
            : await this.pickField(providerPick.provider);
        if (!fieldPick) {
            return;
        }
        await this.promptAndStore(providerPick.provider.id, fieldPick.key);
    }
    async pickField(provider) {
        const picked = await vscode.window.showQuickPick(provider.fields.map((field) => ({
            label: field.label,
            description: field.key,
            field,
        })), { title: `${provider.displayName} — choose field`, ignoreFocusOut: true });
        return picked?.field;
    }
    async handleMessage(raw) {
        if (typeof raw !== "object" || raw === null) {
            return;
        }
        const message = raw;
        switch (message.type) {
            case "ready":
                await this.refresh();
                return;
            case "set":
                if (typeof message.providerId === "string" &&
                    typeof message.fieldKey === "string") {
                    await this.promptAndStore(message.providerId, message.fieldKey);
                }
                return;
            case "remove":
                if (typeof message.providerId === "string" &&
                    typeof message.fieldKey === "string") {
                    await this.removeField(message.providerId, message.fieldKey);
                }
                return;
            case "clearAll":
                await this.clearAll();
                return;
            default:
                return;
        }
    }
    async buildState() {
        const providers = [];
        for (const provider of providers_1.PROVIDERS) {
            const fields = [];
            for (const field of provider.fields) {
                const isSet = await this.secrets.has(provider.id, field.key);
                fields.push({ key: field.key, label: field.label, isSet });
            }
            providers.push({
                id: provider.id,
                displayName: provider.displayName,
                fields,
            });
        }
        return { providers };
    }
    loadHtml() {
        const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "byok", "index.html").fsPath;
        return fs.readFileSync(htmlPath, "utf8");
    }
}
exports.ByokSettingsView = ByokSettingsView;
//# sourceMappingURL=settingsView.js.map