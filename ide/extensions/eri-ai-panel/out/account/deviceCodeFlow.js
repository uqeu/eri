"use strict";
// OAuth device-authorization flow against eri.dev.
//
// Flow:
//   1. POST /api/v1/auth/device/start      → { deviceCode, userCode, verifyUrl, pollIntervalSec, expiresInSec }
//   2. Open verifyUrl in browser (user enters userCode or approves directly).
//   3. Poll /api/v1/auth/device/poll       → { status: "pending"|"approved"|"denied"|"expired", token? }
//      (May be short-circuited by a UriHandler delivering an "auth/callback?code=" deep link.)
//   4. GET  /api/v1/me with Bearer token   → { userId, email, tier } → EriSession.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceCodeFlow = exports.DeviceCodeError = void 0;
const types_1 = require("./types");
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_POLL_INTERVAL_MS = 1_000;
class DeviceCodeError extends Error {
    kind;
    constructor(message, kind) {
        super(message);
        this.kind = kind;
        this.name = "DeviceCodeError";
    }
}
exports.DeviceCodeError = DeviceCodeError;
class DeviceCodeFlow {
    baseUrl;
    fetchImpl;
    opener;
    ui;
    now;
    sleep;
    waitForDeepLink;
    timeoutMs;
    cancelled = false;
    constructor(deps) {
        this.baseUrl = deps.baseUrl.replace(/\/+$/, "");
        this.fetchImpl = deps.fetchImpl ?? fetch;
        this.opener = deps.opener ?? { open: async () => undefined };
        this.ui = deps.ui ?? { show: () => undefined, hide: () => undefined };
        this.now = deps.clock ?? (() => Date.now());
        this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
        this.waitForDeepLink = deps.waitForDeepLink;
        this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }
    cancel() {
        this.cancelled = true;
    }
    async run() {
        const start = await this.startDevice();
        this.ui.show(start);
        try {
            await this.opener.open(start.verifyUrl);
            const token = await this.pollUntilApproved(start);
            const me = await this.fetchMe(token);
            const session = {
                token,
                userId: me.userId,
                email: me.email,
                tier: me.tier,
                signedInAt: new Date(this.now()).toISOString(),
            };
            return session;
        }
        finally {
            this.ui.hide();
        }
    }
    async startDevice() {
        const res = await this.safeFetch(`${this.baseUrl}/api/v1/auth/device/start`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ clientId: "eri-ide", scope: "ide" }),
        });
        if (!res.ok) {
            throw new DeviceCodeError(`device/start ${res.status}`, "network");
        }
        const parsed = parseDeviceStart(await safeJson(res));
        if (!parsed) {
            throw new DeviceCodeError("device/start returned malformed payload", "bad_response");
        }
        return parsed;
    }
    async pollUntilApproved(start) {
        const intervalMs = Math.max(MIN_POLL_INTERVAL_MS, start.pollIntervalSec * 1000);
        const deadline = this.now() + Math.min(this.timeoutMs, start.expiresInSec * 1000);
        while (!this.cancelled && this.now() < deadline) {
            const deepLinkPromise = this.waitForDeepLink?.();
            const winner = deepLinkPromise
                ? await raceFastestFirst(deepLinkPromise, this.sleep(intervalMs))
                : await this.sleep(intervalMs);
            // If a deep link arrived, swap to using its code as the device code.
            const overrideCode = typeof winner === "string" ? winner : null;
            const deviceCode = overrideCode ?? start.deviceCode;
            const res = await this.safeFetch(`${this.baseUrl}/api/v1/auth/device/poll`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ deviceCode }),
            });
            if (!res.ok) {
                // Treat transient HTTP errors as continue-polling, not fatal.
                continue;
            }
            const poll = parseDevicePoll(await safeJson(res));
            if (!poll) {
                continue;
            }
            switch (poll.status) {
                case "approved":
                    if (!poll.token) {
                        throw new DeviceCodeError("approved without token", "bad_response");
                    }
                    return poll.token;
                case "denied":
                    throw new DeviceCodeError("Sign-in denied", "denied");
                case "expired":
                    throw new DeviceCodeError("Device code expired", "expired");
                case "pending":
                default:
                    continue;
            }
        }
        throw new DeviceCodeError(this.cancelled ? "Sign-in cancelled" : "Sign-in timed out", "timeout");
    }
    async fetchMe(token) {
        const res = await this.safeFetch(`${this.baseUrl}/api/v1/me`, {
            method: "GET",
            headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
            throw new DeviceCodeError(`/api/v1/me ${res.status}`, "network");
        }
        const me = parseMe(await safeJson(res));
        if (!me) {
            throw new DeviceCodeError("/api/v1/me malformed payload", "bad_response");
        }
        return me;
    }
    async safeFetch(url, init) {
        try {
            return await this.fetchImpl(url, init);
        }
        catch (err) {
            throw new DeviceCodeError(getMessage(err), "network");
        }
    }
}
exports.DeviceCodeFlow = DeviceCodeFlow;
// --- parsers (no `any`, narrow `unknown` safely) -----------------------------
function parseDeviceStart(payload) {
    if (typeof payload !== "object" || payload === null)
        return null;
    const obj = payload;
    if (typeof obj.deviceCode !== "string")
        return null;
    if (typeof obj.userCode !== "string")
        return null;
    if (typeof obj.verifyUrl !== "string")
        return null;
    const pollIntervalSec = typeof obj.pollIntervalSec === "number" ? obj.pollIntervalSec : 5;
    const expiresInSec = typeof obj.expiresInSec === "number" ? obj.expiresInSec : 600;
    return {
        deviceCode: obj.deviceCode,
        userCode: obj.userCode,
        verifyUrl: obj.verifyUrl,
        pollIntervalSec,
        expiresInSec,
    };
}
function parseDevicePoll(payload) {
    if (typeof payload !== "object" || payload === null)
        return null;
    const obj = payload;
    const status = obj.status;
    if (status !== "pending" &&
        status !== "approved" &&
        status !== "denied" &&
        status !== "expired") {
        return null;
    }
    const token = typeof obj.token === "string" ? obj.token : undefined;
    return token !== undefined ? { status, token } : { status };
}
function parseMe(payload) {
    if (typeof payload !== "object" || payload === null)
        return null;
    const obj = payload;
    if (typeof obj.userId !== "string")
        return null;
    if (typeof obj.email !== "string")
        return null;
    if (!(0, types_1.isEriTier)(obj.tier))
        return null;
    return { userId: obj.userId, email: obj.email, tier: obj.tier };
}
async function safeJson(res) {
    try {
        return await res.json();
    }
    catch {
        return null;
    }
}
function getMessage(err) {
    if (err instanceof Error)
        return err.message;
    return "unknown network error";
}
/**
 * Returns whichever input resolves first. If the second (timer) resolves with
 * `undefined`, we surface `undefined` (i.e. "interval elapsed"). If the
 * first (deep-link) resolves with a string code, we surface that.
 */
async function raceFastestFirst(deepLink, timer) {
    const dl = deepLink.then((code) => (code ? code : Symbol("none")));
    const tm = timer.then(() => Symbol("tick"));
    const winner = await Promise.race([dl, tm]);
    return typeof winner === "string" ? winner : undefined;
}
//# sourceMappingURL=deviceCodeFlow.js.map