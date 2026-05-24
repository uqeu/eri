"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewFindingsProvider = void 0;
exports.activateReview = activateReview;
const vscode = require("vscode");
const findingsView_1 = require("./findingsView");
const commands_1 = require("./commands");
/**
 * Activate the eri-review surface: tree view, panel, and commands. Returns a
 * handle the extension owner can dispose on deactivate.
 */
function activateReview(context, getSidecar) {
    const provider = new findingsView_1.ReviewFindingsProvider();
    const view = vscode.window.createTreeView("eri.review", {
        treeDataProvider: provider,
        showCollapseAll: true,
    });
    const commandDisposables = (0, commands_1.registerReviewCommands)(context, provider, getSidecar);
    for (const d of commandDisposables) {
        context.subscriptions.push(d);
    }
    context.subscriptions.push(view);
    return {
        view,
        dispose: () => {
            view.dispose();
            provider.dispose();
        },
    };
}
var findingsView_2 = require("./findingsView");
Object.defineProperty(exports, "ReviewFindingsProvider", { enumerable: true, get: function () { return findingsView_2.ReviewFindingsProvider; } });
__exportStar(require("./types"), exports);
//# sourceMappingURL=index.js.map