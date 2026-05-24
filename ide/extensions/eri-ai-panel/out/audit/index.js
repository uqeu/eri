"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateAudit = activateAudit;
const vscode = require("vscode");
const commands_1 = require("./commands");
const view_1 = require("./view");
function activateAudit(context, getSidecar) {
    const provider = new view_1.AuditTreeDataProvider();
    const view = vscode.window.createTreeView("eri.audit", {
        treeDataProvider: provider,
        showCollapseAll: true,
    });
    const handle = (0, commands_1.registerAuditCommands)(context, getSidecar, provider);
    // Initial fetch — fire-and-forget; failures surface as placeholder rows.
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