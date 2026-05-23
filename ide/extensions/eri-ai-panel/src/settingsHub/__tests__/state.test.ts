// Lightweight unit tests for the settings hub state builder.
// Runs without a test runner: `node out/settingsHub/__tests__/state.test.js`.
// Uses node's built-in assert — no extra dev dependencies.

import { strict as assert } from "node:assert";
import {
  buildSettingsHubState,
  coerceConfigValue,
  coerceWorkspaceValue,
  isAllowedConfigKey,
  isAllowedWorkspaceKey,
  type BuildStateInput,
  type ConfigSource,
  type StateSource,
} from "../state";

function makeConfig(values: Record<string, unknown>): ConfigSource {
  return {
    get<T>(key: string): T | undefined {
      return values[key] as T | undefined;
    },
  };
}

function makeWorkspace(values: Record<string, unknown>): StateSource {
  return {
    get<T>(key: string): T | undefined {
      return values[key] as T | undefined;
    },
  };
}

function baseInput(
  config: ConfigSource,
  workspace: StateSource,
): BuildStateInput {
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
  const state = buildSettingsHubState(
    baseInput(makeConfig({}), makeWorkspace({})),
  );
  assert.equal(state.voice.enabled, true);
  assert.equal(state.voice.preset, "lumen");
  assert.equal(state.gaze.enabled, true);
  assert.equal(state.gaze.sensitivity, 50);
  assert.equal(state.gaze.lastCalibration, null);
  assert.equal(state.model.default, "auto");
  assert.equal(state.model.autoRouting, true);
  assert.equal(state.privacy.telemetry, false);
  assert.equal(state.appearance.theme, "auto");
  assert.equal(state.appearance.fontSize, 13);
}

// Reads user-provided values
{
  const state = buildSettingsHubState(
    baseInput(
      makeConfig({
        "voice.enabled": false,
        "gaze.enabled": false,
        "model.default": "mercury-2",
        "model.autoRouting": false,
        "privacy.telemetry": true,
        "appearance.theme": "dark",
        "appearance.fontSize": 16,
      }),
      makeWorkspace({
        "eri.voice.preset": "sable",
        "eri.gaze.sensitivity": 75,
        "eri.gaze.lastCalibration": "2026-05-20T12:00:00Z",
      }),
    ),
  );
  assert.equal(state.voice.enabled, false);
  assert.equal(state.voice.preset, "sable");
  assert.equal(state.gaze.enabled, false);
  assert.equal(state.gaze.sensitivity, 75);
  assert.equal(state.gaze.lastCalibration, "2026-05-20T12:00:00Z");
  assert.equal(state.model.default, "mercury-2");
  assert.equal(state.model.autoRouting, false);
  assert.equal(state.privacy.telemetry, true);
  assert.equal(state.appearance.theme, "dark");
  assert.equal(state.appearance.fontSize, 16);
}

// Clamps numeric out-of-range values
{
  const state = buildSettingsHubState(
    baseInput(
      makeConfig({ "appearance.fontSize": 999 }),
      makeWorkspace({ "eri.gaze.sensitivity": -10 }),
    ),
  );
  assert.equal(state.appearance.fontSize, 20);
  assert.equal(state.gaze.sensitivity, 1);
}

// Allowed key validation
{
  assert.equal(isAllowedConfigKey("voice.enabled"), true);
  assert.equal(isAllowedConfigKey("voice.hotMic"), false);
  assert.equal(isAllowedWorkspaceKey("eri.voice.preset"), true);
  assert.equal(isAllowedWorkspaceKey("eri.evil"), false);
}

// Coercion
{
  assert.equal(coerceConfigValue("voice.enabled", true), true);
  assert.equal(coerceConfigValue("voice.enabled", "true"), undefined);
  assert.equal(coerceConfigValue("appearance.theme", "neon"), undefined);
  assert.equal(coerceConfigValue("appearance.theme", "light"), "light");
  assert.equal(coerceConfigValue("appearance.fontSize", 4), 10);
  assert.equal(coerceConfigValue("appearance.fontSize", 99), 20);
  assert.equal(coerceWorkspaceValue("eri.voice.preset", ""), undefined);
  assert.equal(coerceWorkspaceValue("eri.voice.preset", "kiln"), "kiln");
  assert.equal(coerceWorkspaceValue("eri.gaze.sensitivity", 200), 100);
}

console.log("settingsHub/state tests passed");
