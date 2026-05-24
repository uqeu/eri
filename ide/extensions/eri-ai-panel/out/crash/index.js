"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateCrash = activateCrash;
const vscode = require("vscode");
const commands_1 = require("./commands");
const view_1 = require("./view");
function activateCrash(context, getSidecar) {
    const provider = new view_1.CrashTreeDataProvider();
    const view = vscode.window.createTreeView("eri.crashes", {
        treeDataProvider: provider,
        showCollapseAll: false,
    });
    const handle = (0, commands_1.registerCrashCommands)(context, getSidecar, provider);
    // Initial fetch — failures surface as placeholder rows in the tree.
    void handle.refresh();
    context.subscriptions.push(view);
    return {
        view,
        refresh: () => handle.refresh(),
        dispose: () => {
            view.dispose();
        },
    };
}
//# sourceMappingURL=index.js.map