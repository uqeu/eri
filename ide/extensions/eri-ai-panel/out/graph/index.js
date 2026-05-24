"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateGraph = activateGraph;
const vscode = require("vscode");
const api_1 = require("./api");
const view_1 = require("./view");
const commands_1 = require("./commands");
// Wire the eri.graph tree view + commands into the activity bar. Lives next
// to Codemaps under the eri activity-bar container.
function activateGraph(context, getSidecar) {
    const client = new api_1.GraphClient(getSidecar, api_1.currentWorkspaceFsPath);
    const provider = new view_1.GraphTreeDataProvider(client);
    const view = vscode.window.createTreeView("eri.graph", {
        treeDataProvider: provider,
        showCollapseAll: true,
    });
    (0, commands_1.registerGraphCommands)(context, provider, client);
    context.subscriptions.push(view);
    // Fire and forget — first paint just shows a placeholder until refresh
    // completes, so the user never sees an empty tree.
    void provider.refresh();
    return {
        view,
        refresh: () => provider.refresh(),
        dispose: () => view.dispose(),
    };
}
//# sourceMappingURL=index.js.map