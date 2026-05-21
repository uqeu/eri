"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateComposer = activateComposer;
const vscode = require("vscode");
const composerView_1 = require("./composerView");
const FORWARDED_METHODS = new Set([
    "eri/composer/plan/result",
    "eri/composer/applied",
    "eri/composer/error",
    "eri/model/changed",
]);
function activateComposer(context, getSidecar, atMentions) {
    const view = new composerView_1.ComposerView(context, getSidecar, atMentions);
    context.subscriptions.push({
        dispose: () => view.dispose(),
    });
    context.subscriptions.push(vscode.commands.registerCommand("eri.composer.applyAll", () => {
        view.applyAll();
    }), vscode.commands.registerCommand("eri.composer.discard", () => {
        view.discard();
    }));
    return {
        open: () => view.open(),
        applyAll: () => view.applyAll(),
        discard: () => view.discard(),
        forward: (notification) => {
            if (FORWARDED_METHODS.has(notification.method)) {
                view.postFromSidecar(notification);
            }
        },
    };
}
//# sourceMappingURL=composer.js.map