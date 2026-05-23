"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEditorGazeContext = exports.getCurrentGazeTarget = void 0;
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const sidecar_1 = require("./sidecar");
const panel_1 = require("./panel");
const preview_1 = require("./preview");
const tab_1 = require("./tab/tab");
const mentions_1 = require("./mentions/mentions");
const at_mentions_1 = require("./at_mentions");
const mcpRegistry_1 = require("./mcp/mcpRegistry");
const composer_1 = require("./composer/composer");
const gaze_1 = require("./gaze/gaze");
const tierClient_1 = require("./tier/tierClient");
var gaze_2 = require("./gaze/gaze");
Object.defineProperty(exports, "getCurrentGazeTarget", { enumerable: true, get: function () { return gaze_2.getCurrentTarget; } });
Object.defineProperty(exports, "getEditorGazeContext", { enumerable: true, get: function () { return gaze_2.getEditorGazeContext; } });
let sidecar = null;
let panelProvider = null;
let previewManager = null;
let mcpRegistry = null;
let composer = null;
let atMentions = null;
let gaze = null;
let tierClient = null;
function activate(context) {
    const binaryPath = (0, sidecar_1.resolveBinaryPath)(context);
    sidecar = new sidecar_1.Sidecar({
        binaryPath,
        onNotification: handleNotification,
        onExit: (code) => {
            console.warn(`[eri] sidecar exited (code=${code})`);
            sidecar = null;
        },
    });
    sidecar.start();
    panelProvider = new panel_1.EriPanelProvider(context, () => sidecar);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider("eri.panel", panelProvider));
    previewManager = new preview_1.PreviewManager(context);
    context.subscriptions.push(previewManager);
    // Activate tier client right after sidecar starts so the very first
    // setContext + sidecar handshake reflects the user's real tier.
    tierClient = (0, tierClient_1.activateTierClient)(context, () => sidecar);
    (0, tab_1.activateTab)(context, () => sidecar);
    atMentions = (0, at_mentions_1.activateAtMentions)(context, () => sidecar);
    (0, mentions_1.activateMentionCompletions)(context, atMentions.registry);
    mcpRegistry = (0, mcpRegistry_1.activateMcp)(context, () => sidecar);
    gaze = (0, gaze_1.activateGaze)(context, () => sidecar);
    composer = (0, composer_1.activateComposer)(context, () => sidecar, atMentions);
    context.subscriptions.push(vscode.commands.registerCommand("eri.openPreview", () => {
        previewManager?.open();
    }), vscode.commands.registerCommand("eri.toggleMic", () => {
        sidecar?.notify("eri/voice/toggle", {});
    }), vscode.commands.registerCommand("eri.inlineEdit", () => {
        vscode.commands.executeCommand("editor.action.eriInlineEdit").then(undefined, () => {
            vscode.window.showInformationMessage("eri inline edit — widget contribution missing");
        });
    }), vscode.commands.registerCommand("eri.openChat", () => {
        // Reveal the eri activity-bar container and focus the chat view inside it.
        vscode.commands.executeCommand("workbench.view.extension.eri-activitybar").then(() => vscode.commands.executeCommand("eri.panel.focus"), () => undefined);
    }), vscode.commands.registerCommand("eri.openComposer", () => {
        composer?.open();
    }), vscode.commands.registerCommand("eri.openAgentLayout", () => {
        panelProvider?.postToWebview({ method: "eri/ui/agentLayout", params: {} });
    }), vscode.commands.registerCommand("eri.modeMenu", () => {
        panelProvider?.postToWebview({ method: "eri/ui/modeMenu", params: {} });
    }), vscode.commands.registerCommand("eri.cycleModel", () => {
        sidecar?.notify("eri/model/cycle", {});
    }), vscode.commands.registerCommand("eri.acceptIteration", () => {
        sidecar?.notify("eri/iteration/accept", {});
    }), vscode.commands.registerCommand("eri.rejectIteration", () => {
        sidecar?.notify("eri/iteration/reject", {});
    }), vscode.commands.registerCommand("eri.stopGeneration", () => {
        sidecar?.notify("eri/inference/cancel", {});
    }), vscode.commands.registerCommand("eri.setDiffusionFire", (active) => {
        vscode.commands.executeCommand("setContext", "eri.diffusionFire", !!active);
    }));
}
function deactivate() {
    sidecar?.stop();
    sidecar = null;
    panelProvider = null;
    previewManager = null;
    mcpRegistry?.dispose();
    mcpRegistry = null;
    composer = null;
    atMentions?.dispose();
    atMentions = null;
    gaze?.dispose();
    gaze = null;
    tierClient?.dispose();
    tierClient = null;
}
function handleNotification(notification) {
    composer?.forward(notification);
    gaze?.forward(notification);
    switch (notification.method) {
        case "eri/ready":
            console.log("[eri] sidecar ready", notification.params);
            break;
        case "eri/voice/partial":
        case "eri/voice/final":
        case "eri/inference/delta":
        case "eri/iteration/recorded":
            panelProvider?.postToWebview(notification);
            break;
        case "eri/inference/started":
            vscode.commands.executeCommand("eri.setDiffusionFire", true);
            break;
        case "eri/inference/done":
        case "eri/inference/cancelled":
            vscode.commands.executeCommand("eri.setDiffusionFire", false);
            break;
        case "eri/preview/open":
            previewManager?.open(typeof notification.params === "object" && notification.params
                ? notification.params.sessionPath
                : undefined);
            break;
        case "eri/mcp/serverStatus": {
            const params = notification.params;
            if (params && typeof params.name === "string" && mcpRegistry) {
                const allowed = ["online", "offline", "error"];
                const state = typeof params.state === "string" && allowed.includes(params.state)
                    ? params.state
                    : undefined;
                (0, mcpRegistry_1.applyServerStatus)(mcpRegistry.view, {
                    name: params.name,
                    ...(state ? { state } : {}),
                    ...(typeof params.toolCount === "number" ? { toolCount: params.toolCount } : {}),
                    ...(typeof params.detail === "string" ? { detail: params.detail } : {}),
                });
            }
            break;
        }
        default:
            console.debug("[eri] unhandled notification", notification.method);
    }
}
//# sourceMappingURL=extension.js.map