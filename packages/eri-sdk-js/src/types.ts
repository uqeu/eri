export interface EriOptions {
  /** Bearer token (`eri_sk_*`). Read from `ERI_API_KEY` when omitted. */
  apiKey?: string;
  /** Override the API host. Defaults to `https://tryeri.ca`. */
  baseUrl?: string;
  /** Optional custom fetch implementation (node-fetch, undici, etc). */
  fetch?: typeof fetch;
  /** Request timeout in ms. Defaults to 120 s. */
  timeoutMs?: number;
  /** User-Agent header. Defaults to `@eri/sdk/<version>`. */
  userAgent?: string;
}

export type Intent =
  | "ask"
  | "plan"
  | "ship"
  | "test"
  | "refactor"
  | "explain"
  | "sketch";

export interface AgentRunOptions {
  intent: Intent;
  prompt: string;
  workspaceRoot?: string;
  persona?: string;
  targets?: string[];
  /** Abort controller signal — cancel the stream cleanly. */
  signal?: AbortSignal;
}

/** One event in the streaming response. */
export type AgentEvent = TokenEvent | DoneEvent | ErrorEvent | ToolCallEvent;

export interface TokenEvent {
  kind: "token";
  text: string;
}

export interface DoneEvent {
  kind: "done";
  tokensIn: number;
  tokensOut: number;
  routedTo?: string;
}

export interface ErrorEvent {
  kind: "error";
  message: string;
}

export interface ToolCallEvent {
  kind: "tool_call";
  message?: string;
  name?: string;
  input?: unknown;
}

export interface Observation {
  id: string;
  kind: string;
  body: string;
  tsMs?: number;
}

export interface RecallResult {
  results: Observation[];
}

export interface UsageSummary {
  tier: string;
  tokens: {
    used: number;
    included: number;
    remainingIncluded: number;
    overage: number;
  };
  period: {
    start: string;
    end: string;
  };
}

export class EriError extends Error {
  status: number;
  code?: string;
  /** Raw payload, when the server returned JSON. */
  payload?: unknown;
  constructor(
    message: string,
    status: number,
    code?: string,
    payload?: unknown,
  ) {
    super(message);
    this.name = "EriError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}
