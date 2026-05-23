"use strict";
// Provider registry for BYOK (Bring Your Own Key).
// This is the single source of truth for which providers + which field keys
// the extension is willing to read from / write to SecretStorage. The sidecar
// bridge refuses any lookup that is not declared here.
Object.defineProperty(exports, "__esModule", { value: true });
exports.validators = exports.PROVIDERS = void 0;
exports.getProvider = getProvider;
exports.getProviderField = getProviderField;
exports.isKnownProviderField = isKnownProviderField;
function nonEmpty(value) {
    return value.trim().length === 0 ? "value cannot be empty" : null;
}
function looksLikeKey(prefix) {
    return (value) => {
        if (value.trim().length === 0) {
            return "value cannot be empty";
        }
        if (value.includes(" ") || value.includes("\n")) {
            return "key must not contain whitespace";
        }
        if (prefix.length > 0 && !value.startsWith(prefix)) {
            return `expected key to start with "${prefix}"`;
        }
        return null;
    };
}
function looksLikeUrl(value) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return "URL cannot be empty";
    }
    if (!/^https?:\/\//i.test(trimmed)) {
        return "URL must start with http:// or https://";
    }
    return null;
}
const apiKeyField = (key, label, prefix = "") => ({
    key,
    label,
    kind: "password",
    placeholder: prefix.length > 0 ? `${prefix}...` : "paste API key",
    validator: looksLikeKey(prefix),
});
const baseUrlField = (placeholder) => ({
    key: "base-url",
    label: "Base URL",
    kind: "url",
    placeholder,
    validator: looksLikeUrl,
});
exports.PROVIDERS = Object.freeze([
    {
        id: "anthropic",
        displayName: "Anthropic",
        fields: [apiKeyField("anthropic-api-key", "API Key", "sk-ant-")],
    },
    {
        id: "openai",
        displayName: "OpenAI",
        fields: [apiKeyField("openai-api-key", "API Key", "sk-")],
    },
    {
        id: "google",
        displayName: "Google",
        fields: [apiKeyField("google-api-key", "API Key")],
    },
    {
        id: "xai",
        displayName: "xAI (Grok)",
        fields: [apiKeyField("xai-api-key", "API Key", "xai-")],
    },
    {
        id: "deepseek",
        displayName: "DeepSeek",
        fields: [apiKeyField("deepseek-api-key", "API Key", "sk-")],
    },
    {
        id: "mistral",
        displayName: "Mistral",
        fields: [apiKeyField("mistral-api-key", "API Key")],
    },
    {
        id: "together",
        displayName: "Together AI",
        fields: [apiKeyField("together-api-key", "API Key")],
    },
    {
        id: "openrouter",
        displayName: "OpenRouter",
        fields: [apiKeyField("openrouter-api-key", "API Key", "sk-or-")],
    },
    {
        id: "custom-openai",
        displayName: "Custom OpenAI-compatible endpoint",
        fields: [
            baseUrlField("https://api.example.com/v1"),
            apiKeyField("api-key", "API Key"),
        ],
    },
    {
        id: "ollama",
        displayName: "Local (Ollama)",
        fields: [
            {
                key: "base-url",
                label: "Base URL",
                kind: "url",
                placeholder: "http://localhost:11434",
                validator: looksLikeUrl,
            },
        ],
    },
]);
const PROVIDER_BY_ID = new Map(exports.PROVIDERS.map((provider) => [provider.id, provider]));
function getProvider(providerId) {
    return PROVIDER_BY_ID.get(providerId) ?? null;
}
function getProviderField(providerId, fieldKey) {
    const provider = PROVIDER_BY_ID.get(providerId);
    if (!provider) {
        return null;
    }
    return provider.fields.find((field) => field.key === fieldKey) ?? null;
}
function isKnownProviderField(providerId, fieldKey) {
    return getProviderField(providerId, fieldKey) !== null;
}
// Used by the validator chain and the no-op nonEmpty export (kept available
// for future field additions that want a generic check).
exports.validators = Object.freeze({
    nonEmpty,
    looksLikeUrl,
});
//# sourceMappingURL=providers.js.map