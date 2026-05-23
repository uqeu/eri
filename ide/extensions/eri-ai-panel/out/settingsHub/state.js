"use strict";
// Pure mapping from VSCode configuration + workspace/global state to the
// shape the settings-hub webview hydrates from. Kept side-effect free so it
// can be unit-tested without spinning up a real ExtensionContext.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSettingsHubState = buildSettingsHubState;
exports.isAllowedConfigKey = isAllowedConfigKey;
exports.isAllowedWorkspaceKey = isAllowedWorkspaceKey;
exports.coerceConfigValue = coerceConfigValue;
exports.coerceWorkspaceValue = coerceWorkspaceValue;
const DEFAULTS = {
    voiceEnabled: true,
    voicePreset: "lumen",
    gazeEnabled: true,
    gazeSensitivity: 50,
    modelDefault: "auto",
    modelAutoRouting: true,
    indexEnabled: true,
    telemetry: false,
    theme: "auto",
    fontSize: 13,
};
function readBool(source, key, fallback) {
    const value = source.get(key);
    return typeof value === "boolean" ? value : fallback;
}
function readNumber(source, key, fallback, min, max) {
    const value = source.get(key);
    if (typeof value !== "number" || Number.isNaN(value)) {
        return fallback;
    }
    if (value < min)
        return min;
    if (value > max)
        return max;
    return value;
}
function readString(source, key, fallback) {
    const value = source.get(key);
    return typeof value === "string" && value.length > 0 ? value : fallback;
}
function readTheme(source) {
    const value = source.get("appearance.theme");
    if (value === "light" || value === "dark" || value === "auto") {
        return value;
    }
    return DEFAULTS.theme;
}
function buildSettingsHubState(input) {
    const { config, workspaceState } = input;
    return {
        account: input.account,
        providers: input.providers,
        voice: {
            enabled: readBool(config, "voice.enabled", DEFAULTS.voiceEnabled),
            preset: readString(workspaceState, "eri.voice.preset", DEFAULTS.voicePreset),
            micPermission: input.micPermission,
        },
        gaze: {
            enabled: readBool(config, "gaze.enabled", DEFAULTS.gazeEnabled),
            sensitivity: readNumber(workspaceState, "eri.gaze.sensitivity", DEFAULTS.gazeSensitivity, 1, 100),
            lastCalibration: readString(workspaceState, "eri.gaze.lastCalibration", "") || null,
        },
        model: {
            default: readString(config, "model.default", DEFAULTS.modelDefault),
            autoRouting: readBool(config, "model.autoRouting", DEFAULTS.modelAutoRouting),
        },
        index: {
            enabled: readBool(config, "index.enabled", DEFAULTS.indexEnabled),
            summary: input.indexSummary,
        },
        mcp: input.mcp,
        rules: { count: input.rulesCount },
        privacy: {
            telemetry: readBool(config, "privacy.telemetry", DEFAULTS.telemetry),
        },
        appearance: {
            theme: readTheme(config),
            fontSize: readNumber(config, "appearance.fontSize", DEFAULTS.fontSize, 10, 20),
        },
        about: input.about,
    };
}
// Whitelisted configuration keys the webview is allowed to write back. Any
// other key is rejected by `applyConfigUpdate`.
const ALLOWED_CONFIG_KEYS = new Set([
    "voice.enabled",
    "gaze.enabled",
    "model.default",
    "model.autoRouting",
    "index.enabled",
    "privacy.telemetry",
    "appearance.theme",
    "appearance.fontSize",
]);
const ALLOWED_WORKSPACE_KEYS = new Set([
    "eri.voice.preset",
    "eri.gaze.sensitivity",
    "eri.gaze.lastCalibration",
]);
function isAllowedConfigKey(key) {
    return ALLOWED_CONFIG_KEYS.has(key);
}
function isAllowedWorkspaceKey(key) {
    return ALLOWED_WORKSPACE_KEYS.has(key);
}
// Coerces an unknown value from the webview into the type appropriate for the
// given configuration key. Returns `undefined` to signal "reject".
function coerceConfigValue(key, raw) {
    switch (key) {
        case "voice.enabled":
        case "gaze.enabled":
        case "model.autoRouting":
        case "index.enabled":
        case "privacy.telemetry":
            return typeof raw === "boolean" ? raw : undefined;
        case "model.default":
            return typeof raw === "string" && raw.length > 0 ? raw : undefined;
        case "appearance.theme":
            return raw === "light" || raw === "dark" || raw === "auto" ? raw : undefined;
        case "appearance.fontSize":
            if (typeof raw !== "number" || Number.isNaN(raw))
                return undefined;
            if (raw < 10)
                return 10;
            if (raw > 20)
                return 20;
            return raw;
        default:
            return undefined;
    }
}
function coerceWorkspaceValue(key, raw) {
    switch (key) {
        case "eri.voice.preset":
            return typeof raw === "string" && raw.length > 0 ? raw : undefined;
        case "eri.gaze.sensitivity":
            if (typeof raw !== "number" || Number.isNaN(raw))
                return undefined;
            if (raw < 1)
                return 1;
            if (raw > 100)
                return 100;
            return raw;
        case "eri.gaze.lastCalibration":
            return typeof raw === "string" ? raw : undefined;
        default:
            return undefined;
    }
}
//# sourceMappingURL=state.js.map