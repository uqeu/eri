"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateTierClient = activateTierClient;
const vscode = require("vscode");
const TIER_NAMES = ["Free", "Starter", "Pro", "Pro+", "Teams"];
const FEATURE_NAMES = [
    "voice",
    "diffusionPreview",
    "iterationHistory",
    "gaze",
    "inlineEdit",
    "composer",
    "agentMode",
    "mentions",
    "codebaseIndex",
    "mcp",
    "multiModel",
    "cloudAgents",
    "exclusiveVoices",
    "codebaseTrainedBrain",
    "privateContext",
    "polishQueue",
    "sso",
    "auditLogs",
    "scim",
];
const SECRET_KEY = "eri.accessToken";
const STATE_KEY = "eri.tierState";
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_API_BASE = "https://eri.dev";
function isTierName(value) {
    return typeof value === "string" && TIER_NAMES.includes(value);
}
function isFeature(value) {
    return typeof value === "string" && FEATURE_NAMES.includes(value);
}
function parseMeResponse(payload) {
    if (typeof payload !== "object" || payload === null)
        return null;
    const obj = payload;
    if (typeof obj.userId !== "string")
        return null;
    if (!isTierName(obj.tier))
        return null;
    if (!Array.isArray(obj.features))
        return null;
    const features = obj.features.filter(isFeature);
    const rateLimits = obj.rateLimits;
    return {
        userId: obj.userId,
        tier: obj.tier,
        features,
        ...(rateLimits ? { rateLimits } : {}),
    };
}
function activateTierClient(context, getSidecar) {
    let state = loadCached(context) ?? { tier: "Free", features: [] };
    let timer = null;
    const apply = () => {
        void vscode.commands.executeCommand("setContext", "eri.tier", state.tier);
        const allowed = new Set(state.features);
        for (const feature of FEATURE_NAMES) {
            void vscode.commands.executeCommand("setContext", `eri.feature.${feature}`, allowed.has(feature));
        }
        // Mirror the same source of truth into the Rust sidecar so request-level
        // gating matches the UI without a second source of truth.
        getSidecar()?.notify("eri/auth/setTier", {
            tier: state.tier,
            features: state.features,
        });
    };
    const fetchAndApply = async () => {
        const token = await context.secrets.get(SECRET_KEY);
        if (!token) {
            // No token yet — Free tier silently. Apply so context keys exist.
            state = { tier: "Free", features: [] };
            apply();
            return;
        }
        const baseUrl = vscode.workspace.getConfiguration("eri").get("apiBaseUrl")?.trim() ||
            DEFAULT_API_BASE;
        try {
            const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/me`, {
                method: "GET",
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!response.ok) {
                console.warn(`[eri] /api/v1/me returned ${response.status}; using Free fallback`);
                state = { tier: "Free", features: [] };
                apply();
                return;
            }
            const json = await response.json();
            const parsed = parseMeResponse(json);
            if (!parsed) {
                console.warn("[eri] /api/v1/me returned unexpected payload; using Free fallback");
                state = { tier: "Free", features: [] };
                apply();
                return;
            }
            state = {
                tier: parsed.tier,
                features: parsed.features,
                ...(parsed.rateLimits ? { rateLimits: parsed.rateLimits } : {}),
            };
            await context.workspaceState.update(STATE_KEY, state);
            apply();
        }
        catch (err) {
            // Offline / DNS / fetch failure — keep the previous tier (which may be
            // a cached paid tier from last session) but never escalate above what
            // we already have.
            console.warn("[eri] tier fetch failed, keeping cached tier", err);
            apply();
        }
    };
    // Apply cached state immediately so UI doesn't flicker between
    // "Free" and the real tier on cold start.
    apply();
    void fetchAndApply();
    timer = setInterval(() => {
        void fetchAndApply();
    }, POLL_INTERVAL_MS);
    return {
        getTier: () => state.tier,
        getFeatures: () => new Set(state.features),
        refresh: fetchAndApply,
        dispose: () => {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        },
    };
}
function loadCached(context) {
    const raw = context.workspaceState.get(STATE_KEY);
    if (typeof raw !== "object" || raw === null)
        return null;
    const obj = raw;
    if (!isTierName(obj.tier))
        return null;
    if (!Array.isArray(obj.features))
        return null;
    const features = obj.features.filter(isFeature);
    return { tier: obj.tier, features };
}
//# sourceMappingURL=tierClient.js.map