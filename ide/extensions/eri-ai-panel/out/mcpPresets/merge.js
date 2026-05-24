"use strict";
// Pure (no-vscode) merge logic shared by installer.ts and the tests.
//
// The goal is to insert/update a single MCP server entry under `mcpServers`
// while preserving the rest of the JSON tree byte-for-byte (well, semantically
// — JSON.stringify will canonicalize whitespace, but the keys we don't touch
// keep their values).
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergePreset = mergePreset;
/**
 * Returns a NEW config object with the given preset merged in. Never mutates
 * the input. Existing entry's extra fields are preserved.
 */
function mergePreset(config, preset, options) {
    const servers = (config.mcpServers ?? {});
    const existing = servers[preset.id] ?? {};
    const env = {};
    for (const envVar of preset.requiredEnv) {
        if (envVar.secret) {
            env[envVar.name] = `\${secret:${preset.id}/${envVar.name}}`;
        }
        else if (typeof options.plainEnv[envVar.name] === "string") {
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
    const args = preset.args.map((arg) => arg.replace("${workspaceFolder}", options.workspaceFolder));
    const nextServer = {
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
//# sourceMappingURL=merge.js.map