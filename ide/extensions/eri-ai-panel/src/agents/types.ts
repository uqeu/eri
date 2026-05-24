// Type definitions for the eri multi-agent picker.
//
// "Agent" here means the brain handling a chat turn — Mercury (default),
// proxy-hosted frontier models (Claude/GPT/Gemini), BYOK direct calls, or
// local CLI subprocesses (Claude Code, Codex, Aider, …).
//
// All shapes are immutable — consumers should treat them as `Readonly<…>`.

export type AgentKind = "mercury" | "proxy" | "byok" | "cli" | "auto";

export type AgentVendor =
  | "eri"
  | "anthropic"
  | "openai"
  | "google"
  | "local"
  | "custom";

export interface AgentDescriptor {
  /** Stable id, e.g. "eri.agent.mercury", "eri.agent.claude-code". */
  readonly id: string;
  /** Human-readable label shown in pickers / status bar. */
  readonly label: string;
  readonly vendor: AgentVendor;
  /** Underlying model identifier (proxy/byok only). */
  readonly model?: string;
  readonly kind: AgentKind;
  /** Short tooltip / description. */
  readonly description: string;
  /** Optional codicon name, e.g. "rocket", "terminal". */
  readonly icon?: string;
  /** Dynamically detected — false hides from default picker. */
  readonly available: boolean;
  /** True ⇒ doesn't count against eri token quota. */
  readonly free: boolean;
  /** CLI binary path (kind === "cli"). */
  readonly binary?: string;
  /** Baseline binary arguments (template tokens like ${workspaceRoot}). */
  readonly binaryArgs?: ReadonlyArray<string>;
  /** Custom user-defined agents come from disk; built-ins are coded. */
  readonly source: "builtin" | "user";
}

export interface AgentContextFile {
  readonly path: string;
  readonly content: string;
}

export interface AgentContext {
  readonly files: ReadonlyArray<AgentContextFile>;
  readonly voiceInput?: boolean;
}

export interface AgentTurn {
  readonly prompt: string;
  readonly workspaceRoot?: string;
  readonly context: AgentContext;
}

export type AgentStreamEventKind =
  | "token"
  | "tool_call"
  | "edit_proposed"
  | "done"
  | "error";

export interface AgentStreamEvent {
  readonly kind: AgentStreamEventKind;
  readonly payload: unknown;
}

export interface AgentDoneEvent {
  readonly kind: "done";
  readonly payload: {
    readonly exit_code?: number;
    readonly tokens_in?: number;
    readonly tokens_out?: number;
    readonly cost_micros?: number;
    readonly routedTo?: string;
  };
}

export interface AgentErrorEvent {
  readonly kind: "error";
  readonly payload: {
    readonly kind: "over_quota" | "binary_missing" | "auth" | "network" | "unknown";
    readonly message: string;
  };
}

export interface AgentBackend {
  /**
   * Execute a turn and yield streaming events. Implementations must honor
   * cancellation tokens and clean up subprocesses / network connections.
   */
  run(
    descriptor: AgentDescriptor,
    turn: AgentTurn,
    signal: AbortSignal,
  ): AsyncIterable<AgentStreamEvent>;
}

export interface UserAgentFile {
  readonly agents: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly kind: AgentKind;
    readonly binary?: string;
    readonly binaryArgs?: ReadonlyArray<string>;
    readonly description?: string;
    readonly vendor?: AgentVendor;
    readonly model?: string;
  }>;
}
