/**
 * Provider configuration for the eri Engine proxy. Master keys are read
 * once per process from env vars (NEVER committed). Anything the IDE
 * sends in the body is forwarded verbatim except for the upstream auth
 * header, which we always overwrite with the master key.
 */

export type ProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "inception"
  | "deepseek";

export interface ProviderConfig {
  id: ProviderId;
  envKey: string;
  defaultUrl: string;
  authHeader: (key: string) => Record<string, string>;
}

const ANTHROPIC: ProviderConfig = {
  id: "anthropic",
  envKey: "ANTHROPIC_MASTER_KEY",
  defaultUrl: "https://api.anthropic.com/v1/messages",
  authHeader: (key) => ({
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
  }),
};

const OPENAI: ProviderConfig = {
  id: "openai",
  envKey: "OPENAI_MASTER_KEY",
  defaultUrl: "https://api.openai.com/v1/chat/completions",
  authHeader: (key) => ({ authorization: `Bearer ${key}` }),
};

const GOOGLE: ProviderConfig = {
  id: "google",
  envKey: "GOOGLE_MASTER_KEY",
  defaultUrl: "https://generativelanguage.googleapis.com/v1beta/models",
  authHeader: (key) => ({ "x-goog-api-key": key }),
};

const INCEPTION: ProviderConfig = {
  id: "inception",
  envKey: "INCEPTION_MASTER_KEY",
  defaultUrl: "https://api.inceptionlabs.ai/v1/chat/completions",
  authHeader: (key) => ({ authorization: `Bearer ${key}` }),
};

// DeepSeek exposes a drop-in Anthropic Messages endpoint, so it shares the
// exact request/response shape (and SSE usage frames) as ANTHROPIC — only the
// URL + key differ. Pre-wired but inert until the route flag flips it on; see
// resolveModelRoute in routing.ts. Off by default (Claude credits are free
// until ~Nov); this matters only once those expire and cost is real money.
const DEEPSEEK: ProviderConfig = {
  id: "deepseek",
  envKey: "DEEPSEEK_MASTER_KEY",
  defaultUrl: "https://api.deepseek.com/anthropic/v1/messages",
  authHeader: (key) => ({
    "x-api-key": key,
    authorization: `Bearer ${key}`,
    "anthropic-version": "2023-06-01",
  }),
};

const REGISTRY: Record<ProviderId, ProviderConfig> = {
  anthropic: ANTHROPIC,
  openai: OPENAI,
  google: GOOGLE,
  inception: INCEPTION,
  deepseek: DEEPSEEK,
};

export function providerConfig(id: ProviderId): ProviderConfig {
  return REGISTRY[id];
}

export function isProviderId(value: string): value is ProviderId {
  return (
    value === "anthropic" ||
    value === "openai" ||
    value === "google" ||
    value === "inception" ||
    value === "deepseek"
  );
}

export class MissingMasterKeyError extends Error {
  constructor(public readonly provider: ProviderId, envKey: string) {
    super(`Missing master key env var: ${envKey}`);
    this.name = "MissingMasterKeyError";
  }
}

export function getMasterKey(provider: ProviderId): string {
  const config = providerConfig(provider);
  const value = process.env[config.envKey];
  if (!value || value.length === 0) {
    throw new MissingMasterKeyError(provider, config.envKey);
  }
  return value;
}
