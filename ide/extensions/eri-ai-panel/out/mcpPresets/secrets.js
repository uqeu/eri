"use strict";
// MCP env-var SecretStorage wrapper.
//
// API keys required by MCP servers (GITHUB_PERSONAL_ACCESS_TOKEN, BRAVE_API_KEY,
// SLACK_BOT_TOKEN, ...) are stored in the OS keychain via vscode.SecretStorage.
// We never write them into mcp.json plaintext. The sidecar resolves them at
// runtime via the BYOK key bridge (see settings/sidecarBridge.ts).
//
// Index is tracked in globalState so we can list installed secrets without
// scanning every possible key. globalState holds *names only* — values stay in
// SecretStorage.
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpSecretsStore = void 0;
const KEY_PREFIX = "eri.mcp.env";
const INDEX_KEY = "eri.mcp.env.index.v1";
function buildKey(serverId, envName) {
    return `${KEY_PREFIX}.${serverId}.${envName}`;
}
function isRef(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value;
    return (typeof candidate.serverId === "string" &&
        typeof candidate.envName === "string");
}
function parseIndex(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out = [];
    for (const item of raw) {
        if (isRef(item)) {
            out.push({ serverId: item.serverId, envName: item.envName });
        }
    }
    return out;
}
function sameRef(a, b) {
    return a.serverId === b.serverId && a.envName === b.envName;
}
class McpSecretsStore {
    storage;
    globalState;
    constructor(storage, globalState) {
        this.storage = storage;
        this.globalState = globalState;
    }
    async get(serverId, envName) {
        return this.storage.get(buildKey(serverId, envName));
    }
    async set(serverId, envName, value) {
        await this.storage.store(buildKey(serverId, envName), value);
        await this.addToIndex({ serverId, envName });
    }
    async clear(serverId, envName) {
        const index = parseIndex(this.globalState.get(INDEX_KEY));
        const targets = index.filter((entry) => {
            if (entry.serverId !== serverId) {
                return false;
            }
            if (typeof envName === "string" && entry.envName !== envName) {
                return false;
            }
            return true;
        });
        for (const target of targets) {
            await this.storage.delete(buildKey(target.serverId, target.envName));
        }
        const remaining = index.filter((entry) => !targets.some((target) => sameRef(entry, target)));
        await this.globalState.update(INDEX_KEY, remaining);
    }
    async list() {
        return parseIndex(this.globalState.get(INDEX_KEY));
    }
    async has(serverId, envName) {
        const value = await this.get(serverId, envName);
        return typeof value === "string" && value.length > 0;
    }
    async addToIndex(entry) {
        const index = parseIndex(this.globalState.get(INDEX_KEY));
        if (index.some((existing) => sameRef(existing, entry))) {
            return;
        }
        await this.globalState.update(INDEX_KEY, [...index, entry]);
    }
}
exports.McpSecretsStore = McpSecretsStore;
//# sourceMappingURL=secrets.js.map