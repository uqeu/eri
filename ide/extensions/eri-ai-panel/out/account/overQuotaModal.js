"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.showOverQuotaModal = showOverQuotaModal;
exports.isOverQuotaError = isOverQuotaError;
const vscode = require("vscode");
async function showOverQuotaModal(opts = {}) {
    const title = opts.title ?? "Token quota reached.";
    const detail = formatDetail(opts);
    const action = await vscode.window.showErrorMessage(title + (detail ? " " + detail : ""), { modal: false }, "Upgrade", "Use my own keys", "Switch to Mercury-only");
    if (action === "Upgrade") {
        await vscode.env.openExternal(vscode.Uri.parse("https://eri.dev/dashboard/billing"));
    }
    else if (action === "Use my own keys") {
        await vscode.commands.executeCommand("eri.byok.setKey");
    }
    else if (action === "Switch to Mercury-only") {
        await vscode.commands.executeCommand("eri.agents.setActive", "eri.agent.mercury");
        vscode.window.showInformationMessage("Switched to Mercury — iteration keeps working without frontier tokens.");
    }
}
/**
 * Detect the OverQuota JSON-RPC code in an arbitrary error so callers can
 * pipe `e.message` here without parsing the wire format themselves.
 */
function isOverQuotaError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("-32402") || message.includes("OVER_QUOTA");
}
function formatDetail(opts) {
    const parts = [];
    if (opts.tier) {
        parts.push(`tier=${opts.tier}`);
    }
    if (typeof opts.remainingTokens === "number") {
        parts.push(`remaining=${opts.remainingTokens.toLocaleString()} tokens`);
    }
    return parts.length > 0 ? `(${parts.join(", ")})` : "";
}
//# sourceMappingURL=overQuotaModal.js.map