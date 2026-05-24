// Built-in agent descriptors.
//
// `available` is filled in at runtime by the registry (after sign-in /
// CLI detection / BYOK key check) — the defaults here are conservative
// (false) for anything that needs detection, true for Mercury which is
// always present when signed in.

import { AgentDescriptor } from "./types";

export const AGENT_ID = {
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
} as const;

export type BuiltinAgentId = (typeof AGENT_ID)[keyof typeof AGENT_ID];

export function builtinDescriptors(): ReadonlyArray<AgentDescriptor> {
  return [
    {
      id: AGENT_ID.auto,
      label: "Auto (smart routing)",
      vendor: "eri",
      kind: "auto",
      description:
        "eri picks the right brain per turn — Mercury for edits/builds, frontier for debug/explain.",
      icon: "rocket",
      available: true,
      free: true,
      source: "builtin",
    },
    {
      id: AGENT_ID.mercury,
      label: "Mercury (eri Engine)",
      vendor: "eri",
      kind: "mercury",
      description: "Diffusion engine. Free on all tiers.",
      icon: "zap",
      available: true,
      free: true,
      source: "builtin",
    },
    {
      id: AGENT_ID.claudeProxy,
      label: "Claude Sonnet 4.6 (eri)",
      vendor: "anthropic",
      kind: "proxy",
      model: "claude-sonnet-4-6",
      description: "Frontier reasoning via eri proxy. Counts toward your token quota.",
      icon: "rocket",
      available: false,
      free: false,
      source: "builtin",
    },
    {
      id: AGENT_ID.gptProxy,
      label: "GPT-5 (eri)",
      vendor: "openai",
      kind: "proxy",
      model: "gpt-5",
      description: "OpenAI frontier via eri proxy. Counts toward your token quota.",
      icon: "rocket",
      available: false,
      free: false,
      source: "builtin",
    },
    {
      id: AGENT_ID.geminiProxy,
      label: "Gemini 2.5 Pro (eri)",
      vendor: "google",
      kind: "proxy",
      model: "gemini-2.5-pro",
      description: "Google frontier via eri proxy. Counts toward your token quota.",
      icon: "rocket",
      available: false,
      free: false,
      source: "builtin",
    },
    {
      id: AGENT_ID.claudeByok,
      label: "Claude (your key)",
      vendor: "anthropic",
      kind: "byok",
      model: "claude-sonnet-4-6",
      description: "Direct to Anthropic with your API key. You pay Anthropic.",
      icon: "key",
      available: false,
      free: true,
      source: "builtin",
    },
    {
      id: AGENT_ID.gptByok,
      label: "GPT (your key)",
      vendor: "openai",
      kind: "byok",
      model: "gpt-5",
      description: "Direct to OpenAI with your API key. You pay OpenAI.",
      icon: "key",
      available: false,
      free: true,
      source: "builtin",
    },
    {
      id: AGENT_ID.geminiByok,
      label: "Gemini (your key)",
      vendor: "google",
      kind: "byok",
      model: "gemini-2.5-pro",
      description: "Direct to Google with your API key. You pay Google.",
      icon: "key",
      available: false,
      free: true,
      source: "builtin",
    },
    {
      id: AGENT_ID.claudeCode,
      label: "Claude Code (local)",
      vendor: "local",
      kind: "cli",
      description:
        "Runs the Claude Code CLI in your workspace. Uses your own Anthropic subscription.",
      icon: "terminal",
      available: false,
      free: true,
      binary: "claude",
      binaryArgs: ["--workspace", "${workspaceRoot}", "--json"],
      source: "builtin",
    },
    {
      id: AGENT_ID.codex,
      label: "Codex (local)",
      vendor: "local",
      kind: "cli",
      description:
        "OpenAI Codex CLI subprocess. Uses your own OpenAI subscription.",
      icon: "terminal",
      available: false,
      free: true,
      binary: "codex",
      binaryArgs: ["--cwd", "${workspaceRoot}", "--json"],
      source: "builtin",
    },
    {
      id: AGENT_ID.aider,
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
    },
  ];
}

/**
 * Per-CLI parser hints. Keyed by binary name (basename of the configured
 * binary path). Unknown binaries fall back to opaque text passthrough.
 */
export interface CliParserHint {
  readonly format: "ndjson" | "text";
  /** If true, send the prompt on stdin instead of appending as final arg. */
  readonly promptOnStdin: boolean;
}

export function cliParserHint(binaryBasename: string): CliParserHint {
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
