"use strict";
// Activator for the Visual Editor feature. Wires the panel + commands and
// returns a handle the host extension can use to forward sidecar events.
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateVisualEditor = activateVisualEditor;
const vscode = require("vscode");
const api_1 = require("../graph/api");
const panel_1 = require("./panel");
function activateVisualEditor(context, getSidecar) {
    const graphClient = new api_1.GraphClient(getSidecar, api_1.currentWorkspaceFsPath);
    const panel = new panel_1.VisualEditorPanel({
        context,
        sessionLogger: {
            async logChange(change) {
                try {
                    await graphClient.insertNode("visual_edit", {
                        selector: change.selector,
                        styles: change.styles,
                        voiceTriggered: false,
                        gazeTargeted: false,
                    }, ["visual-editor"]);
                }
                catch {
                    // graph crate may not be wired yet; degrade silently.
                }
            },
        },
    });
    const disposables = [
        vscode.commands.registerCommand("eri.visualEditor.open", () => panel.open()),
        vscode.commands.registerCommand("eri.visualEditor.setUrl", () => panel.setUrl()),
        vscode.commands.registerCommand("eri.visualEditor.pickElement", () => panel.pickElement()),
        vscode.commands.registerCommand("eri.visualEditor.applyToSource", () => panel.applyAccumulated()),
    ];
    for (const d of disposables) {
        context.subscriptions.push(d);
    }
    return {
        forward(notification) {
            panel.forwardSidecar(notification);
        },
        dispose() {
            for (const d of disposables) {
                d.dispose();
            }
            panel.dispose();
        },
    };
}
//# sourceMappingURL=index.js.map