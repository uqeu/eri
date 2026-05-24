// Installer for MCP presets.
//
// Reads the existing mcp.json (creating if absent), merges in a new server
// entry under `mcpServers`, and writes back. Unrelated entries are preserved
// byte-for-byte where possible (we re-emit the JSON tree, but never drop
// fields we don't recognize on other servers).
//
// API keys are NEVER written into mcp.json. They flow through McpSecretsStore
// and are injected by the sidecar at runtime via the BYOK key bridge.

import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  getPreset,
  McpPreset,
  McpPresetEnvVar,
} from "./catalog";
import { readMcpConfig, writeMcpConfig } from "./configFile";
import { mergePreset, RawServerEntry } from "./merge";
import { McpSecretsStore } from "./secrets";
import { writeAuditEntry } from "./audit";

const DEFAULT_CONFIG_DIR = ".eri";
const DEFAULT_CONFIG_FILE = "mcp.json";

export interface InstallResult {
  readonly serverId: string;
  readonly path: string;
  readonly missingSecrets: ReadonlyArray<string>;
}

export interface InstallPlan {
  readonly preset: McpPreset;
  /** Env vars whose values are NOT yet in SecretStorage. Caller should prompt. */
  readonly pendingSecretEnv: ReadonlyArray<McpPresetEnvVar>;
  /** Non-secret env vars the caller should collect with a plain input box. */
  readonly pendingPlainEnv: ReadonlyArray<McpPresetEnvVar>;
}

export function resolveMcpConfigPath(): string {
  const override = vscode.workspace
    .getConfiguration("eri")
    .get<string>("mcp.configPath");
  if (typeof override === "string" && override.trim().length > 0) {
    return path.isAbsolute(override) ? override : path.resolve(override);
  }
  return path.join(os.homedir(), DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_FILE);
}

/**
 * Compute what the caller needs to ask the user before/after writing the
 * mcp.json entry. Returns the list of env vars still missing.
 */
export async function planInstall(
  presetId: string,
  secrets: McpSecretsStore,
): Promise<InstallPlan | null> {
  const preset = getPreset(presetId);
  if (!preset || preset.deprecated) {
    return null;
  }
  const pendingSecret: McpPresetEnvVar[] = [];
  const pendingPlain: McpPresetEnvVar[] = [];
  for (const envVar of preset.requiredEnv) {
    if (envVar.secret) {
      const has = await secrets.has(presetId, envVar.name);
      if (!has) {
        pendingSecret.push(envVar);
      }
    } else {
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
export async function installPreset(
  presetId: string,
  options: {
    readonly plainEnv: Readonly<Record<string, string>>;
  },
): Promise<InstallResult> {
  const preset = getPreset(presetId);
  if (!preset) {
    throw new Error(`unknown MCP preset: ${presetId}`);
  }
  if (preset.deprecated) {
    throw new Error(`preset ${presetId} is deprecated`);
  }

  const configPath = resolveMcpConfigPath();
  const config = await readMcpConfig(configPath);
  const nextConfig = mergePreset(config, preset, {
    plainEnv: options.plainEnv,
    workspaceFolder: resolveWorkspaceFolder(),
  });

  await writeMcpConfig(configPath, nextConfig);

  const missingSecrets: string[] = [];
  for (const envVar of preset.requiredEnv) {
    if (envVar.secret) {
      missingSecrets.push(envVar.name);
    }
  }

  await writeAuditEntry({
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

export async function isInstalled(presetId: string): Promise<boolean> {
  const configPath = resolveMcpConfigPath();
  try {
    const config = await readMcpConfig(configPath);
    const servers = (config.mcpServers ?? {}) as Record<string, RawServerEntry>;
    return Object.prototype.hasOwnProperty.call(servers, presetId);
  } catch {
    return false;
  }
}

export async function listInstalledServerIds(): Promise<ReadonlyArray<string>> {
  const configPath = resolveMcpConfigPath();
  try {
    const config = await readMcpConfig(configPath);
    const servers = (config.mcpServers ?? {}) as Record<string, RawServerEntry>;
    return Object.keys(servers);
  } catch {
    return [];
  }
}

function resolveWorkspaceFolder(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    return folder.uri.fsPath;
  }
  return os.homedir();
}
