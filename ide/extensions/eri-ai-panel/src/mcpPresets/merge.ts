// Pure (no-vscode) merge logic shared by installer.ts and the tests.
//
// The goal is to insert/update a single MCP server entry under `mcpServers`
// while preserving the rest of the JSON tree byte-for-byte (well, semantically
// — JSON.stringify will canonicalize whitespace, but the keys we don't touch
// keep their values).

import { McpPreset } from "./catalog";

export interface RawServerEntry {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  transport?: unknown;
  disabled?: unknown;
  [key: string]: unknown;
}

export interface RawConfigRoot {
  mcpServers?: Record<string, RawServerEntry>;
  [key: string]: unknown;
}

export interface MergeOptions {
  readonly plainEnv: Readonly<Record<string, string>>;
  readonly workspaceFolder: string;
}

/**
 * Returns a NEW config object with the given preset merged in. Never mutates
 * the input. Existing entry's extra fields are preserved.
 */
export function mergePreset(
  config: RawConfigRoot,
  preset: McpPreset,
  options: MergeOptions,
): RawConfigRoot {
  const servers = (config.mcpServers ?? {}) as Record<string, RawServerEntry>;
  const existing = servers[preset.id] ?? {};

  const env: Record<string, string> = {};
  for (const envVar of preset.requiredEnv) {
    if (envVar.secret) {
      env[envVar.name] = `\${secret:${preset.id}/${envVar.name}}`;
    } else if (typeof options.plainEnv[envVar.name] === "string") {
      env[envVar.name] = options.plainEnv[envVar.name];
    }
  }
  for (const envVar of preset.optionalEnv) {
    if (envVar.secret) {
      continue;
    }
    if (typeof options.plainEnv[envVar.name] === "string") {
      env[envVar.name] = options.plainEnv[envVar.name];
    }
  }

  const args = preset.args.map((arg) =>
    arg.replace("${workspaceFolder}", options.workspaceFolder),
  );

  const nextServer: RawServerEntry = {
    ...existing,
    command: preset.command,
    args,
    env,
    transport: preset.transport,
    disabled: false,
  };

  return {
    ...config,
    mcpServers: {
      ...servers,
      [preset.id]: nextServer,
    },
  };
}
