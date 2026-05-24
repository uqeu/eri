"use strict";
// Entry point for the eri MCP preset starter pack.
// Registers the browse view, the four commands, and the SecretsStore used to
// hold MCP env-var API keys. Wired from extension.ts during activation.
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateMcpPresets = activateMcpPresets;
const vscode = require("vscode");
const browseView_1 = require("./browseView");
const flow_1 = require("./flow");
const secrets_1 = require("./secrets");
function activateMcpPresets(context) {
    const secrets = new secrets_1.McpSecretsStore(context.secrets, context.globalState);
    const view = new browseView_1.McpPresetsBrowseView(context, secrets);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(browseView_1.PRESETS_VIEW_ID, view));
    const browseCommand = vscode.commands.registerCommand("eri.mcpPresets.browse", async () => {
        await vscode.commands.executeCommand("workbench.view.extension.eri-activitybar");
        await vscode.commands.executeCommand(`${browseView_1.PRESETS_VIEW_ID}.focus`);
        await view.refresh();
    });
    const installCommand = vscode.commands.registerCommand("eri.mcpPresets.install", async () => {
        const includeBeta = vscode.workspace
            .getConfiguration("eri")
            .get("mcpPresets.includeBeta") ?? false;
        await (0, flow_1.pickAndInstall)({
            secrets,
            onChange: () => {
                void view.refresh();
            },
        }, { includeBeta });
    });
    const recommendedCommand = vscode.commands.registerCommand("eri.mcpPresets.installRecommended", async () => {
        await (0, flow_1.offerSafeDefaults)({
            secrets,
            onChange: () => {
                void view.refresh();
            },
        });
    });
    const refreshCommand = vscode.commands.registerCommand("eri.mcpPresets.refresh", async () => {
        await view.refresh();
    });
    context.subscriptions.push(browseCommand, installCommand, recommendedCommand, refreshCommand);
    return {
        secrets,
        dispose: () => {
            // Commands and view providers are disposed via context.subscriptions.
        },
    };
}
//# sourceMappingURL=index.js.map