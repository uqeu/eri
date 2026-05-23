"use strict";
// SecretsStore — thin wrapper over `vscode.SecretStorage` that:
//   1. uses a consistent key naming scheme `eri.byok.<providerId>.<fieldKey>`,
//   2. tracks the set of written keys in `globalState` so we can offer a
//      `list()` API (SecretStorage itself does not expose an enumeration API),
//   3. never logs values.
//
// IMPORTANT: globalState holds NAMES ONLY (provider id + field key). Values
// stay in SecretStorage which routes to the OS keychain.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecretsStore = void 0;
const providers_1 = require("./providers");
const KEY_PREFIX = "eri.byok";
const INDEX_KEY = "eri.byok.index.v1";
function buildKey(providerId, fieldKey) {
    return `${KEY_PREFIX}.${providerId}.${fieldKey}`;
}
function isIndexEntry(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const candidate = value;
    return (typeof candidate.providerId === "string" &&
        typeof candidate.fieldKey === "string");
}
function parseIndex(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out = [];
    for (const item of raw) {
        if (isIndexEntry(item) && (0, providers_1.isKnownProviderField)(item.providerId, item.fieldKey)) {
            out.push({ providerId: item.providerId, fieldKey: item.fieldKey });
        }
    }
    return out;
}
function sameRef(a, b) {
    return a.providerId === b.providerId && a.fieldKey === b.fieldKey;
}
class SecretsStore {
    storage;
    globalState;
    constructor(storage, globalState) {
        this.storage = storage;
        this.globalState = globalState;
    }
    async get(providerId, fieldKey) {
        if (!(0, providers_1.isKnownProviderField)(providerId, fieldKey)) {
            return undefined;
        }
        return this.storage.get(buildKey(providerId, fieldKey));
    }
    async set(providerId, fieldKey, value) {
        if (!(0, providers_1.isKnownProviderField)(providerId, fieldKey)) {
            throw new Error("unknown provider or field");
        }
        await this.storage.store(buildKey(providerId, fieldKey), value);
        await this.addToIndex({ providerId, fieldKey });
    }
    async clear(providerId, fieldKey) {
        const index = parseIndex(this.globalState.get(INDEX_KEY));
        const targets = index.filter((entry) => {
            if (entry.providerId !== providerId) {
                return false;
            }
            if (typeof fieldKey === "string" && entry.fieldKey !== fieldKey) {
                return false;
            }
            return true;
        });
        for (const target of targets) {
            await this.storage.delete(buildKey(target.providerId, target.fieldKey));
        }
        const remaining = index.filter((entry) => !targets.some((target) => sameRef(entry, target)));
        await this.globalState.update(INDEX_KEY, remaining);
    }
    async clearAll() {
        const index = parseIndex(this.globalState.get(INDEX_KEY));
        for (const entry of index) {
            await this.storage.delete(buildKey(entry.providerId, entry.fieldKey));
        }
        await this.globalState.update(INDEX_KEY, []);
    }
    async list() {
        return parseIndex(this.globalState.get(INDEX_KEY)).map((entry) => ({
            providerId: entry.providerId,
            fieldKey: entry.fieldKey,
        }));
    }
    async has(providerId, fieldKey) {
        const value = await this.get(providerId, fieldKey);
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
exports.SecretsStore = SecretsStore;
//# sourceMappingURL=secrets.js.map