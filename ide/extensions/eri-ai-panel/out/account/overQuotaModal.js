"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.showOverQuotaModal = showOverQuotaModal;
exports.isOverQuotaError = isOverQuotaError;
exports.showRateLimitToast = showRateLimitToast;
exports.isRateLimitedError = isRateLimitedError;
exports.parseRateLimitedPayload = parseRateLimitedPayload;
const vscode = require("vscode");
async function showOverQuotaModal(opts = {}) {
    const title = opts.title ?? "Token quota reached.";
    const detail = formatDetail(opts);
    const action = await vscode.window.showErrorMessage(title + (detail ? " " + detail : ""), { modal: false }, "Upgrade", "Use my own keys", "Switch to Mercury-only");
    if (action === "Upgrade") {
        // Honour the configured account base URL so self-hosted + staging
        // installs route to the right billing page (production default is
        // tryeri.ca; older builds had eri.dev as the placeholder).
        const baseUrl = vscode.workspace
            .getConfiguration("eri.account")
            .get("baseUrl", "https://tryeri.ca") || "https://tryeri.ca";
        await vscode.env.openExternal(vscode.Uri.parse(`${baseUrl.replace(/\/+$/, "")}/dashboard/billing`));
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
/**
 * Non-blocking rate-limit warning. Distinct from over-quota — the user
 * is INSIDE their monthly budget but has hit a short-window throttle
 * (per-minute, per-hour). Terminal + Mercury still work while the
 * window rolls over; we only soft-block the frontier proxy.
 */
async function showRateLimitToast(opts = {}) {
    const tier = opts.tier ?? "free";
    const window = opts.window ?? "minute";
    const reset = formatResetClock(opts.resetAt);
    const title = `${tier} ${window} cap reached`;
    const detail = reset ? ` — resets in ${reset}.` : ".";
    if (opts.statusBar && opts.resetAt) {
        opts.statusBar.setRateLimit({ window, resetAt: opts.resetAt });
    }
    const action = await vscode.window.showWarningMessage(title + detail + " Terminal and Mercury still work.", { modal: false }, "Add my key", "Switch to Mercury-only", "Dismiss");
    if (action === "Add my key") {
        await vscode.commands.executeCommand("eri.byok.setKey");
    }
    else if (action === "Switch to Mercury-only") {
        await vscode.commands.executeCommand("eri.agents.setActive", "eri.agent.mercury");
        vscode.window.showInformationMessage("Switched to Mercury — iteration keeps working while the cap rolls over.");
    }
}
/**
 * Detect the RateLimited JSON-RPC code in an arbitrary error so callers
 * can pipe `e.message` here without parsing the wire format themselves.
 */
function isRateLimitedError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("-32429") || message.includes("RATE_LIMIT");
}
/**
 * Parse the structured payload out of a RateLimited error message so the
 * UI can show the tier + window + reset clock. The wire format is
 * `RATE_LIMIT: {"tier":"...","window":"...","resetAt":"..."}`.
 */
function parseRateLimitedPayload(error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = /RATE_LIMIT:\s*(\{.*\})/.exec(message);
    if (!match)
        return {};
    try {
        const parsed = JSON.parse(match[1]);
        return {
            tier: typeof parsed.tier === "string" ? parsed.tier : undefined,
            window: typeof parsed.window === "string" ? parsed.window : undefined,
            resetAt: typeof parsed.resetAt === "string" ? parsed.resetAt : undefined,
        };
    }
    catch {
        return {};
    }
}
function formatResetClock(iso) {
    if (!iso)
        return "";
    const target = Date.parse(iso);
    if (!Number.isFinite(target))
        return "";
    const deltaMs = target - Date.now();
    if (deltaMs <= 0)
        return "now";
    const totalSec = Math.ceil(deltaMs / 1000);
    if (totalSec < 60)
        return `${totalSec}s`;
    const min = Math.ceil(totalSec / 60);
    if (min < 60)
        return `${min} min`;
    const hr = Math.floor(min / 60);
    const remMin = min % 60;
    return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
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