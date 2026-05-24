"use strict";
// UsageClient — fetches the current period's token usage from /api/v1/usage
// and exposes it as a vscode.Event so the status bar and webview can react.
//
// Handles auth errors gracefully:
//   - 401 / 403 → treat as "session invalid", emit null, caller can sign-out.
//   - over_quota body → still emits the usage payload; UI shows red.
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsageClient = void 0;
exports.remainingIncludedPct = remainingIncludedPct;
const vscode = require("vscode");
const types_1 = require("./types");
const DEFAULT_INTERVAL_SEC = 30;
class UsageClient {
    deps;
    baseUrl;
    fetchImpl;
    emitter = new vscode.EventEmitter();
    last = null;
    constructor(deps) {
        this.deps = deps;
        this.baseUrl = deps.baseUrl.replace(/\/+$/, "");
        this.fetchImpl = deps.fetchImpl ?? fetch;
    }
    get onUsage() {
        return this.emitter.event;
    }
    current() {
        return this.last;
    }
    /** Returns null if not signed in or fetch failed. */
    async fetchUsage() {
        const session = this.deps.getSession();
        if (!session) {
            this.last = null;
            this.emitter.fire(null);
            return null;
        }
        let res;
        try {
            res = await this.fetchImpl(`${this.baseUrl}/api/v1/usage`, {
                method: "GET",
                headers: { authorization: `Bearer ${session.token}` },
            });
        }
        catch {
            return this.last;
        }
        if (res.status === 401 || res.status === 403) {
            this.deps.onUnauthorized?.();
            this.last = null;
            this.emitter.fire(null);
            return null;
        }
        if (!res.ok) {
            return this.last;
        }
        const parsed = parseUsage(await safeJson(res));
        if (!parsed) {
            return this.last;
        }
        this.last = parsed;
        this.emitter.fire(parsed);
        return parsed;
    }
    startPolling(intervalSec = DEFAULT_INTERVAL_SEC) {
        const ms = Math.max(5, intervalSec) * 1000;
        // Fire immediately, then on interval.
        void this.fetchUsage();
        const timer = setInterval(() => {
            void this.fetchUsage();
        }, ms);
        return new vscode.Disposable(() => clearInterval(timer));
    }
    dispose() {
        this.emitter.dispose();
    }
}
exports.UsageClient = UsageClient;
function parseUsage(payload) {
    if (typeof payload !== "object" || payload === null)
        return null;
    const obj = payload;
    if (!(0, types_1.isEriTier)(obj.tier))
        return null;
    const num = (key) => {
        const v = obj[key];
        return typeof v === "number" && Number.isFinite(v) ? v : null;
    };
    const tokensUsed = num("tokensUsed");
    const tokensIncluded = num("tokensIncluded");
    const tokensGhost = num("tokensGhost");
    const remainingIncluded = num("remainingIncluded");
    const remainingGhost = num("remainingGhost");
    if (tokensUsed === null ||
        tokensIncluded === null ||
        tokensGhost === null ||
        remainingIncluded === null ||
        remainingGhost === null) {
        return null;
    }
    const softCapWarning = obj.softCapWarning === true;
    const periodEnd = typeof obj.periodEnd === "string" ? obj.periodEnd : "";
    return {
        tier: obj.tier,
        tokensUsed,
        tokensIncluded,
        tokensGhost,
        remainingIncluded,
        remainingGhost,
        softCapWarning,
        periodEnd,
    };
}
async function safeJson(res) {
    try {
        return await res.json();
    }
    catch {
        return null;
    }
}
/** Pure helper: percentage of included tokens still available, clamped 0..100. */
function remainingIncludedPct(usage) {
    if (usage.tokensIncluded <= 0)
        return 0;
    const pct = (usage.remainingIncluded / usage.tokensIncluded) * 100;
    if (!Number.isFinite(pct))
        return 0;
    if (pct < 0)
        return 0;
    if (pct > 100)
        return 100;
    return pct;
}
//# sourceMappingURL=usageClient.js.map