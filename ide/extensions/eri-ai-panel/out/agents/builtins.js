"use strict";
// Built-in agent descriptors.
//
// `available` is filled in at runtime by the registry (after sign-in /
// CLI detection / BYOK key check) — the defaults here are conservative
// (false) for anything that needs detection, true for Mercury which is
// always present when signed in.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_ID = void 0;
exports.builtinDescriptors = builtinDescriptors;
exports.cliParserHint = cliParserHint;
exports.AGENT_ID = {
    auto: "eri.agent.auto",
    mercury: "eri.agent.mercury",
    claudeProxy: "eri.agent.claude.proxy",
    gptProxy: "eri.agent.gpt.proxy",
    geminiProxy: "eri.agent.gemini.proxy",
    claudeByok: "eri.agent.claude.byok",
    gptByok: "eri.agent.gpt.byok",
    geminiByok: "eri.agent.gemini.byok",
    claudeCode: "eri.agent.claude-code",
    codex: "eri.agent.codex",
    aider: "eri.agent.aider",
};
function builtinDescriptors() {
    return [
        {
            id: exports.AGENT_ID.auto,
            label: "eri",
            vendor: "eri",
            kind: "auto",
            description: "Mercury for fast edits + iteration; Sonnet / GPT-4o / Gemini routed automatically when you need frontier reasoning.",
            icon: "rocket",
            available: true,
            free: true,
            source: "builtin",
            surface: "default",
        },
        {
            id: exports.AGENT_ID.mercury,
            label: "Mercury (eri Engine)",
            vendor: "eri",
            kind: "mercury",
            description: "Diffusion engine. Routed to by eri for edit / build / refactor intents.",
            icon: "zap",
            available: true,
            free: true,
            source: "builtin",
            // Hidden from the picker — eri picks Mercury internally per intent.
            // Surfaced only via Settings → "Force Mercury" or the persona system.
            surface: "hidden",
        },
        {
            id: exports.AGENT_ID.claudeProxy,
            label: "Claude Sonnet 4.5 (eri)",
            vendor: "anthropic",
            kind: "proxy",
            model: "claude-sonnet-4-5-20251015",
            description: "Frontier reasoning routed via eri proxy. Counts toward your token quota.",
            icon: "rocket",
            available: false,
            free: false,
            source: "builtin",
            // Hidden — eri dispatches to it under the hood for Debug / Explain / Chat.
            surface: "hidden",
        },
        {
            id: exports.AGENT_ID.gptProxy,
            label: "GPT-4o (eri)",
            vendor: "openai",
            kind: "proxy",
            model: "gpt-4o",
            description: "OpenAI frontier routed via eri proxy. Counts toward your token quota.",
            icon: "rocket",
            available: false,
            free: false,
            source: "builtin",
            surface: "hidden",
        },
        {
            id: exports.AGENT_ID.geminiProxy,
            label: "Gemini Flash Thinking (eri)",
            vendor: "google",
            kind: "proxy",
            model: "gemini-2.0-flash-thinking-exp",
            description: "Google frontier routed via eri proxy. Counts toward your token quota.",
            icon: "rocket",
            available: false,
            free: false,
            source: "builtin",
            surface: "hidden",
        },
        {
            id: exports.AGENT_ID.claudeByok,
            label: "Claude (your key)",
            vendor: "anthropic",
            kind: "byok",
            model: "claude-sonnet-4-5-20251015",
            description: "Direct to Anthropic with your API key. You pay Anthropic. Opus etc. allowed here.",
            icon: "key",
            available: false,
            free: true,
            source: "builtin",
            surface: "byok",
        },
        {
            id: exports.AGENT_ID.gptByok,
            label: "GPT (your key)",
            vendor: "openai",
            kind: "byok",
            model: "gpt-4o",
            description: "Direct to OpenAI with your API key. You pay OpenAI. o1 / GPT-5 Pro allowed here.",
            icon: "key",
            available: false,
            free: true,
            source: "builtin",
            surface: "byok",
        },
        {
            id: exports.AGENT_ID.geminiByok,
            label: "Gemini (your key)",
            vendor: "google",
            kind: "byok",
            model: "gemini-2.0-flash-thinking-exp",
            description: "Direct to Google with your API key. You pay Google. Gemini 1.5 Pro allowed here.",
            icon: "key",
            available: false,
            free: true,
            source: "builtin",
            surface: "byok",
        },
        {
            id: exports.AGENT_ID.claudeCode,
            label: "Claude Code (local)",
            vendor: "local",
            kind: "cli",
            description: "Runs the Claude Code CLI in your workspace. Uses your own Anthropic subscription.",
            icon: "terminal",
            available: false,
            free: true,
            binary: "claude",
            binaryArgs: ["--workspace", "${workspaceRoot}", "--json"],
            source: "builtin",
            surface: "cli",
        },
        {
            id: exports.AGENT_ID.codex,
            label: "Codex (local)",
            vendor: "local",
            kind: "cli",
            description: "OpenAI Codex CLI subprocess. Uses your own OpenAI subscription.",
            icon: "terminal",
            available: false,
            free: true,
            binary: "codex",
            binaryArgs: ["--cwd", "${workspaceRoot}", "--json"],
            source: "builtin",
            surface: "cli",
        },
        {
            id: exports.AGENT_ID.aider,
            label: "Aider (local)",
            vendor: "local",
            kind: "cli",
            description: "Aider pair-programming CLI. Uses your own provider key.",
            icon: "terminal",
            available: false,
            free: true,
            binary: "aider",
            binaryArgs: ["--no-auto-commits", "--no-pretty", "--message"],
            source: "builtin",
            surface: "cli",
        },
    ];
}
function cliParserHint(binaryBasename) {
    switch (binaryBasename) {
        case "claude":
            return { format: "ndjson", promptOnStdin: true };
        case "codex":
        case "openai-codex":
            return { format: "ndjson", promptOnStdin: true };
        case "aider":
            return { format: "text", promptOnStdin: false };
        default:
            return { format: "text", promptOnStdin: false };
    }
}
//# sourceMappingURL=builtins.js.map