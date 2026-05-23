"use strict";
// Lightweight unit tests for the settings hub state builder.
// Runs without a test runner: `node out/settingsHub/__tests__/state.test.js`.
// Uses node's built-in assert — no extra dev dependencies.
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const state_1 = require("../state");
function makeConfig(values) {
    return {
        get(key) {
            return values[key];
        },
    };
}
function makeWorkspace(values) {
    return {
        get(key) {
            return values[key];
        },
    };
}
function baseInput(config, workspace) {
    return {
        config,
        workspaceState: workspace,
        account: { signedIn: false, tier: "free", billingUrl: "https://eri.dev/billing" },
        providers: [],
        micPermission: "unknown",
        indexSummary: { files: 0, chunks: 0 },
        mcp: [],
        rulesCount: 0,
        about: { version: "0.0.0", buildDate: "2026-05-23", channel: "Stable" },
    };
}
// Defaults when config provides nothing
{
    const state = (0, state_1.buildSettingsHubState)(baseInput(makeConfig({}), makeWorkspace({})));
    node_assert_1.strict.equal(state.voice.enabled, true);
    node_assert_1.strict.equal(state.voice.preset, "lumen");
    node_assert_1.strict.equal(state.gaze.enabled, true);
    node_assert_1.strict.equal(state.gaze.sensitivity, 50);
    node_assert_1.strict.equal(state.gaze.lastCalibration, null);
    node_assert_1.strict.equal(state.model.default, "auto");
    node_assert_1.strict.equal(state.model.autoRouting, true);
    node_assert_1.strict.equal(state.privacy.telemetry, false);
    node_assert_1.strict.equal(state.appearance.theme, "auto");
    node_assert_1.strict.equal(state.appearance.fontSize, 13);
}
// Reads user-provided values
{
    const state = (0, state_1.buildSettingsHubState)(baseInput(makeConfig({
        "voice.enabled": false,
        "gaze.enabled": false,
        "model.default": "mercury-2",
        "model.autoRouting": false,
        "privacy.telemetry": true,
        "appearance.theme": "dark",
        "appearance.fontSize": 16,
    }), makeWorkspace({
        "eri.voice.preset": "sable",
        "eri.gaze.sensitivity": 75,
        "eri.gaze.lastCalibration": "2026-05-20T12:00:00Z",
    })));
    node_assert_1.strict.equal(state.voice.enabled, false);
    node_assert_1.strict.equal(state.voice.preset, "sable");
    node_assert_1.strict.equal(state.gaze.enabled, false);
    node_assert_1.strict.equal(state.gaze.sensitivity, 75);
    node_assert_1.strict.equal(state.gaze.lastCalibration, "2026-05-20T12:00:00Z");
    node_assert_1.strict.equal(state.model.default, "mercury-2");
    node_assert_1.strict.equal(state.model.autoRouting, false);
    node_assert_1.strict.equal(state.privacy.telemetry, true);
    node_assert_1.strict.equal(state.appearance.theme, "dark");
    node_assert_1.strict.equal(state.appearance.fontSize, 16);
}
// Clamps numeric out-of-range values
{
    const state = (0, state_1.buildSettingsHubState)(baseInput(makeConfig({ "appearance.fontSize": 999 }), makeWorkspace({ "eri.gaze.sensitivity": -10 })));
    node_assert_1.strict.equal(state.appearance.fontSize, 20);
    node_assert_1.strict.equal(state.gaze.sensitivity, 1);
}
// Allowed key validation
{
    node_assert_1.strict.equal((0, state_1.isAllowedConfigKey)("voice.enabled"), true);
    node_assert_1.strict.equal((0, state_1.isAllowedConfigKey)("voice.hotMic"), false);
    node_assert_1.strict.equal((0, state_1.isAllowedWorkspaceKey)("eri.voice.preset"), true);
    node_assert_1.strict.equal((0, state_1.isAllowedWorkspaceKey)("eri.evil"), false);
}
// Coercion
{
    node_assert_1.strict.equal((0, state_1.coerceConfigValue)("voice.enabled", true), true);
    node_assert_1.strict.equal((0, state_1.coerceConfigValue)("voice.enabled", "true"), undefined);
    node_assert_1.strict.equal((0, state_1.coerceConfigValue)("appearance.theme", "neon"), undefined);
    node_assert_1.strict.equal((0, state_1.coerceConfigValue)("appearance.theme", "light"), "light");
    node_assert_1.strict.equal((0, state_1.coerceConfigValue)("appearance.fontSize", 4), 10);
    node_assert_1.strict.equal((0, state_1.coerceConfigValue)("appearance.fontSize", 99), 20);
    node_assert_1.strict.equal((0, state_1.coerceWorkspaceValue)("eri.voice.preset", ""), undefined);
    node_assert_1.strict.equal((0, state_1.coerceWorkspaceValue)("eri.voice.preset", "kiln"), "kiln");
    node_assert_1.strict.equal((0, state_1.coerceWorkspaceValue)("eri.gaze.sensitivity", 200), 100);
}
console.log("settingsHub/state tests passed");
//# sourceMappingURL=state.test.js.map