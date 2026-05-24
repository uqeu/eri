"use strict";
// Installer for MCP presets.
//
// Reads the existing mcp.json (creating if absent), merges in a new server
// entry under `mcpServers`, and writes back. Unrelated entries are preserved
// byte-for-byte where possible (we re-emit the JSON tree, but never drop
// fields we don't recognize on other servers).
//
// API keys are NEVER written into mcp.json. They flow through McpSecretsStore
// and are injected by the sidecar at runtime via the BYOK key bridge.
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMcpConfigPath = resolveMcpConfigPath;
exports.planInstall = planInstall;
exports.installPreset = installPreset;
exports.isInstalled = isInstalled;
exports.listInstalledServerIds = listInstalledServerIds;
const os = require("os");
const path = require("path");
const vscode = require("vscode");
const catalog_1 = require("./catalog");
const configFile_1 = require("./configFile");
const merge_1 = require("./merge");
const audit_1 = require("./audit");
const DEFAULT_CONFIG_DIR = ".eri";
const DEFAULT_CONFIG_FILE = "mcp.json";
function resolveMcpConfigPath() {
    const override = vscode.workspace
        .getConfiguration("eri")
        .get("mcp.configPath");
    if (typeof override === "string" && override.trim().length > 0) {
        return path.isAbsolute(override) ? override : path.resolve(override);
    }
    return path.join(os.homedir(), DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_FILE);
}
/**
 * Compute what the caller needs to ask the user before/after writing the
 * mcp.json entry. Returns the list of env vars still missing.
 */
async function planInstall(presetId, secrets) {
    const preset = (0, catalog_1.getPreset)(presetId);
    if (!preset || preset.deprecated) {
        return null;
    }
    const pendingSecret = [];
    const pendingPlain = [];
    for (const envVar of preset.requiredEnv) {
        if (envVar.secret) {
            const has = await secrets.has(presetId, envVar.name);
            if (!has) {
                pendingSecret.push(envVar);
            }
        }
        else {
            pendingPlain.push(envVar);
        }
    }
    return {
        preset,
        pendingSecretEnv: pendingSecret,
        pendingPlainEnv: pendingPlain,
    };
}
/**
 * Merge a preset into the mcp.json under `mcpServers[preset.id]`. Existing
 * entries with the same key are overwritten only on their command/args/env
 * fields — any extra fields the user added (e.g. custom `disabled` flag or
 * a `metadata` block) are preserved.
 *
 * Plain (non-secret) env vars provided by the caller are written into the
 * `env` block of the server entry. Secret env vars are referenced by
 * `${secret:<serverId>/<envName>}` so the sidecar can resolve them at runtime
 * via the BYOK key bridge.
 */
async function installPreset(presetId, options) {
    const preset = (0, catalog_1.getPreset)(presetId);
    if (!preset) {
        throw new Error(`unknown MCP preset: ${presetId}`);
    }
    if (preset.deprecated) {
        throw new Error(`preset ${presetId} is deprecated`);
    }
    const configPath = resolveMcpConfigPath();
    const config = await (0, configFile_1.readMcpConfig)(configPath);
    const nextConfig = (0, merge_1.mergePreset)(config, preset, {
        plainEnv: options.plainEnv,
        workspaceFolder: resolveWorkspaceFolder(),
    });
    await (0, configFile_1.writeMcpConfig)(configPath, nextConfig);
    const missingSecrets = [];
    for (const envVar of preset.requiredEnv) {
        if (envVar.secret) {
            missingSecrets.push(envVar.name);
        }
    }
    await (0, audit_1.writeAuditEntry)({
        kind: "mcp_install",
        server_id: preset.id,
        time_ms: Date.now(),
        requires_keys: missingSecrets,
    });
    return {
        serverId: preset.id,
        path: configPath,
        missingSecrets,
    };
}
async function isInstalled(presetId) {
    const configPath = resolveMcpConfigPath();
    try {
        const config = await (0, configFile_1.readMcpConfig)(configPath);
        const servers = (config.mcpServers ?? {});
        return Object.prototype.hasOwnProperty.call(servers, presetId);
    }
    catch {
        return false;
    }
}
async function listInstalledServerIds() {
    const configPath = resolveMcpConfigPath();
    try {
        const config = await (0, configFile_1.readMcpConfig)(configPath);
        const servers = (config.mcpServers ?? {});
        return Object.keys(servers);
    }
    catch {
        return [];
    }
}
function resolveWorkspaceFolder() {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
        return folder.uri.fsPath;
    }
    return os.homedir();
}
//# sourceMappingURL=installer.js.map