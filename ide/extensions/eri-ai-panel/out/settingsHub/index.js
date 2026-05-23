"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsHubProvider = void 0;
exports.activateSettingsHub = activateSettingsHub;
const vscode = require("vscode");
const hubProvider_1 = require("./hubProvider");
Object.defineProperty(exports, "SettingsHubProvider", { enumerable: true, get: function () { return hubProvider_1.SettingsHubProvider; } });
function activateSettingsHub(context) {
    const provider = new hubProvider_1.SettingsHubProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(hubProvider_1.SettingsHubProvider.viewType, provider), vscode.commands.registerCommand("eri.settings.hub", async () => {
        // Reveal the eri activity-bar container, then focus this view.
        await vscode.commands
            .executeCommand("workbench.view.extension.eri-activitybar")
            .then(undefined, () => undefined);
        await vscode.commands
            .executeCommand(`${hubProvider_1.SettingsHubProvider.viewType}.focus`)
            .then(undefined, () => undefined);
        provider.reveal();
    }));
    const handle = {
        provider,
        dispose: () => provider.dispose(),
    };
    context.subscriptions.push({ dispose: () => handle.dispose() });
    return handle;
}
//# sourceMappingURL=index.js.map