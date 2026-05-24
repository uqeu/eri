"use strict";
// User-facing install flow. Handles consent prompts, env var collection,
// secret storage, and the reload prompt after writing mcp.json.
Object.defineProperty(exports, "__esModule", { value: true });
exports.addServer = addServer;
exports.offerSafeDefaults = offerSafeDefaults;
exports.pickAndInstall = pickAndInstall;
const vscode = require("vscode");
const catalog_1 = require("./catalog");
const installer_1 = require("./installer");
/**
 * Add a server by id. Prompts for any missing required env vars (secrets go to
 * SecretStorage, plain values go inline into mcp.json), writes the config, and
 * offers a reload.
 */
async function addServer(presetId, deps) {
    const plan = await (0, installer_1.planInstall)(presetId, deps.secrets);
    if (!plan) {
        void vscode.window.showWarningMessage(`eri MCP: unknown preset "${presetId}"`);
        return;
    }
    const { preset, pendingSecretEnv, pendingPlainEnv } = plan;
    const plainValues = {};
    for (const envVar of pendingPlainEnv) {
        const value = await promptForEnv(preset, envVar, false);
        if (value === undefined) {
            return;
        }
        plainValues[envVar.name] = value;
    }
    for (const envVar of pendingSecretEnv) {
        const value = await promptForEnv(preset, envVar, true);
        if (value === undefined) {
            return;
        }
        await deps.secrets.set(preset.id, envVar.name, value);
    }
    try {
        await (0, installer_1.installPreset)(preset.id, { plainEnv: plainValues });
    }
    catch (err) {
        void vscode.window.showErrorMessage(`eri MCP: failed to install ${preset.displayName} — ${describeError(err)}`);
        return;
    }
    deps.onChange?.();
    const choice = await vscode.window.showInformationMessage(`${preset.displayName} installed. Reload the window to activate.`, "Reload window", "Later");
    if (choice === "Reload window") {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
}
/**
 * Offer the three safe defaults with per-server consent. Each user choice
 * runs through addServer so all the env-var bookkeeping still applies (none
 * of the defaults need secrets, but the flow stays identical).
 */
async function offerSafeDefaults(deps) {
    const presets = catalog_1.RECOMMENDED_SAFE_DEFAULTS.map((id) => (0, catalog_1.getPreset)(id)).filter((preset) => preset !== null);
    if (presets.length === 0) {
        return;
    }
    const choices = await vscode.window.showQuickPick(presets.map((preset) => ({
        label: preset.displayName,
        description: `Allow ${preset.description.toLowerCase()}`,
        picked: true,
        presetId: preset.id,
    })), {
        canPickMany: true,
        title: "Install recommended MCP servers",
        placeHolder: "Uncheck any you don't want. No API keys required.",
    });
    if (!choices || choices.length === 0) {
        return;
    }
    for (const choice of choices) {
        await addServer(choice.presetId, deps);
    }
}
/**
 * Quick-pick a preset by name from the visible catalog and install it.
 */
async function pickAndInstall(deps, options) {
    const presets = (0, catalog_1.visiblePresets)({ includeBeta: options.includeBeta });
    if (presets.length === 0) {
        void vscode.window.showInformationMessage("eri MCP: catalog is empty for the current settings");
        return;
    }
    const pick = await vscode.window.showQuickPick(presets.map((preset) => ({
        label: preset.displayName,
        description: preset.category,
        detail: preset.description,
        presetId: preset.id,
    })), {
        title: "Install MCP server",
        placeHolder: "Pick a server from the eri starter pack",
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!pick) {
        return;
    }
    await addServer(pick.presetId, deps);
}
async function promptForEnv(preset, envVar, secret) {
    const value = await vscode.window.showInputBox({
        title: `${preset.displayName} — ${envVar.label}`,
        prompt: secret
            ? "Stored in the OS keychain. Never written to disk."
            : "Stored inline in .eri/mcp.json.",
        placeHolder: envVar.hint,
        password: secret,
        ignoreFocusOut: true,
        validateInput: (input) => {
            if (input.trim().length === 0) {
                return "value cannot be empty";
            }
            return null;
        },
    });
    if (value === undefined) {
        return undefined;
    }
    return value.trim();
}
function describeError(err) {
    if (err instanceof Error) {
        return err.message;
    }
    return String(err);
}
//# sourceMappingURL=flow.js.map