"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateCodemaps = activateCodemaps;
const vscode = require("vscode");
const view_1 = require("./view");
const commands_1 = require("./commands");
// Wire the Codemaps tree view + commands into the activity bar. The view
// lives next to Checkpoints under the eri activity bar container.
function activateCodemaps(context, getSidecar) {
    const provider = new view_1.CodemapsTreeDataProvider(getSidecar);
    const view = vscode.window.createTreeView("eri.codemaps", {
        treeDataProvider: provider,
        showCollapseAll: false,
    });
    (0, commands_1.registerCodemapCommands)(context, provider, getSidecar);
    context.subscriptions.push(view);
    // Fire and forget — first paint just shows a placeholder until refresh
    // completes, so the user never sees a blank tree.
    void provider.refresh();
    return {
        view,
        refresh: () => provider.refresh(),
        dispose: () => view.dispose(),
    };
}
//# sourceMappingURL=index.js.map