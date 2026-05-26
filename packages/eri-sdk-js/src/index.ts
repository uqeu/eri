// @eri/sdk — TypeScript SDK for the eri agent.
//
// Mirrors the OpenAI / Anthropic SDK ergonomics so an agent built
// around `@eri/sdk` reads like any other call out of the AI ecosystem.
// The whole surface is one class — `Eri` — with `.ask`, `.plan`,
// `.ship`, `.test`, `.refactor`, `.explain`, `.sketch`, plus
// `.memory.{recall, remember, forget}` and `.usage()`.

export { Eri } from "./client.js";
export type {
  EriOptions,
  Intent,
  AgentEvent,
  AgentRunOptions,
  TokenEvent,
  DoneEvent,
  ErrorEvent,
  ToolCallEvent,
  RecallResult,
  Observation,
  UsageSummary,
  EriError,
} from "./types.js";
