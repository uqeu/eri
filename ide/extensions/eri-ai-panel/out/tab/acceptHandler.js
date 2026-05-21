"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAcceptHandlers = registerAcceptHandlers;
const vscode = require("vscode");
// Partial-accept commands rely on VS Code's built-in inline-suggestion controller.
// We forward to the closest native commands so the ghost text state stays
// consistent with the editor's own session bookkeeping.
async function tryExecute(commandIds) {
    for (const id of commandIds) {
        try {
            await vscode.commands.executeCommand(id);
            return true;
        }
        catch (err) {
            console.debug(`[eri.tab] command ${id} unavailable`, err);
        }
    }
    return false;
}
async function acceptWord() {
    const accepted = await tryExecute([
        "editor.action.inlineSuggest.acceptNextWord",
    ]);
    if (!accepted) {
        vscode.window.setStatusBarMessage("eri: no inline suggestion to partial-accept", 1500);
    }
}
async function acceptLine() {
    const accepted = await tryExecute([
        "editor.action.inlineSuggest.acceptNextLine",
        "editor.action.inlineSuggest.commit",
    ]);
    if (!accepted) {
        vscode.window.setStatusBarMessage("eri: no inline suggestion to partial-accept", 1500);
    }
}
function registerAcceptHandlers(context) {
    context.subscriptions.push(vscode.commands.registerCommand("eri.tab.acceptWord", acceptWord), vscode.commands.registerCommand("eri.tab.acceptLine", acceptLine));
}
//# sourceMappingURL=acceptHandler.js.map