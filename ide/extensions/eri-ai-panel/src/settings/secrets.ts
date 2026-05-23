// SecretsStore — thin wrapper over `vscode.SecretStorage` that:
//   1. uses a consistent key naming scheme `eri.byok.<providerId>.<fieldKey>`,
//   2. tracks the set of written keys in `globalState` so we can offer a
//      `list()` API (SecretStorage itself does not expose an enumeration API),
//   3. never logs values.
//
// IMPORTANT: globalState holds NAMES ONLY (provider id + field key). Values
// stay in SecretStorage which routes to the OS keychain.

import * as vscode from "vscode";
import { isKnownProviderField } from "./providers";

const KEY_PREFIX = "eri.byok";
const INDEX_KEY = "eri.byok.index.v1";

export interface SecretRef {
  readonly providerId: string;
  readonly fieldKey: string;
}

interface IndexEntry {
  readonly providerId: string;
  readonly fieldKey: string;
}

function buildKey(providerId: string, fieldKey: string): string {
  return `${KEY_PREFIX}.${providerId}.${fieldKey}`;
}

function isIndexEntry(value: unknown): value is IndexEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { providerId?: unknown; fieldKey?: unknown };
  return (
    typeof candidate.providerId === "string" &&
    typeof candidate.fieldKey === "string"
  );
}

function parseIndex(raw: unknown): ReadonlyArray<IndexEntry> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: IndexEntry[] = [];
  for (const item of raw) {
    if (isIndexEntry(item) && isKnownProviderField(item.providerId, item.fieldKey)) {
      out.push({ providerId: item.providerId, fieldKey: item.fieldKey });
    }
  }
  return out;
}

function sameRef(a: IndexEntry, b: IndexEntry): boolean {
  return a.providerId === b.providerId && a.fieldKey === b.fieldKey;
}

export class SecretsStore {
  constructor(
    private readonly storage: vscode.SecretStorage,
    private readonly globalState: vscode.Memento,
  ) {}

  async get(providerId: string, fieldKey: string): Promise<string | undefined> {
    if (!isKnownProviderField(providerId, fieldKey)) {
      return undefined;
    }
    return this.storage.get(buildKey(providerId, fieldKey));
  }

  async set(providerId: string, fieldKey: string, value: string): Promise<void> {
    if (!isKnownProviderField(providerId, fieldKey)) {
      throw new Error("unknown provider or field");
    }
    await this.storage.store(buildKey(providerId, fieldKey), value);
    await this.addToIndex({ providerId, fieldKey });
  }

  async clear(providerId: string, fieldKey?: string): Promise<void> {
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
    const remaining = index.filter(
      (entry) => !targets.some((target) => sameRef(entry, target)),
    );
    await this.globalState.update(INDEX_KEY, remaining);
  }

  async clearAll(): Promise<void> {
    const index = parseIndex(this.globalState.get(INDEX_KEY));
    for (const entry of index) {
      await this.storage.delete(buildKey(entry.providerId, entry.fieldKey));
    }
    await this.globalState.update(INDEX_KEY, []);
  }

  async list(): Promise<ReadonlyArray<SecretRef>> {
    return parseIndex(this.globalState.get(INDEX_KEY)).map((entry) => ({
      providerId: entry.providerId,
      fieldKey: entry.fieldKey,
    }));
  }

  async has(providerId: string, fieldKey: string): Promise<boolean> {
    const value = await this.get(providerId, fieldKey);
    return typeof value === "string" && value.length > 0;
  }

  private async addToIndex(entry: IndexEntry): Promise<void> {
    const index = parseIndex(this.globalState.get(INDEX_KEY));
    if (index.some((existing) => sameRef(existing, entry))) {
      return;
    }
    await this.globalState.update(INDEX_KEY, [...index, entry]);
  }
}
