"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activatePhase25Onboarding = activatePhase25Onboarding;
const vscode = require("vscode");
const FIRST_RUN_KEY = "eri.phase25.firstRunSeen";
/**
 * Shows a one-time non-modal tip after the workspace finishes activating
 * so users discover the new modal-layout features. We only show it once
 * per machine — the flag lives in globalState so re-opening different
 * workspaces doesn't re-trigger.
 */
function activatePhase25Onboarding(context) {
    const seen = context.globalState.get(FIRST_RUN_KEY, false);
    if (seen)
        return;
    // Fire after a short delay so we don't dogpile on top of crash recovery
    // or sidecar boot toasts.
    const timer = setTimeout(() => void showTip(context), 4000);
    context.subscriptions.push({ dispose: () => clearTimeout(timer) });
}
async function showTip(context) {
    const action = await vscode.window.showInformationMessage("eri can flip into eri mode — chat + big preview side-by-side. Press Cmd+E to try, or set chat position / theme from the Layout panel.", "Open Layout Panel", "Try eri Mode (⌘E)", "Dismiss");
    await context.globalState.update(FIRST_RUN_KEY, true);
    if (action === "Open Layout Panel") {
        await vscode.commands.executeCommand("eri.layout.openSettings");
    }
    else if (action === "Try eri Mode (⌘E)") {
        await vscode.commands.executeCommand("eri.layout.toggleMode");
    }
}
//# sourceMappingURL=phase25.js.map