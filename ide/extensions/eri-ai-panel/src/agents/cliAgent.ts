// CLI-backend agent — spawns a local subprocess (Claude Code, Codex,
// Aider, or a user-defined binary) and translates its stdout/stderr to
// AgentStreamEvent values.
//
// Parsing rules:
//   - NDJSON binaries → each line is JSON.parse'd; common fields
//     (`type`, `content`, `text`) are mapped to token events.
//   - Plain-text binaries → each chunk emitted as a token event.
//
// Lifecycle: child process is killed on abort signal and when this
// iterable is broken out of early. cwd is pinned to workspaceRoot.

import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import * as path from "path";
import { cliParserHint } from "./builtins";
import { AgentBackend, AgentDescriptor, AgentStreamEvent, AgentTurn } from "./types";

export interface CliAgentOptions {
  /**
   * Env vars to strip before exec. CLI agents have their own auth — we
   * never want to leak the user's provider keys into a subprocess.
   */
  readonly envBlocklist: ReadonlyArray<string>;
}

export class CliAgent implements AgentBackend {
  constructor(private readonly opts: CliAgentOptions) {}

  async *run(
    descriptor: AgentDescriptor,
    turn: AgentTurn,
    signal: AbortSignal,
  ): AsyncIterable<AgentStreamEvent> {
    if (!descriptor.binary || descriptor.binary.length === 0) {
      yield {
        kind: "error",
        payload: { kind: "binary_missing", message: "no binary configured" },
      };
      return;
    }
    const args = expandArgs(descriptor.binaryArgs ?? [], turn);
    const hint = cliParserHint(path.basename(descriptor.binary));

    // Build sanitized env (drop blocklisted secrets).
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      if (this.opts.envBlocklist.includes(key)) continue;
      env[key] = value;
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      const finalArgs = hint.promptOnStdin ? args : [...args, turn.prompt];
      child = spawn(descriptor.binary, finalArgs, {
        cwd: turn.workspaceRoot,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      yield {
        kind: "error",
        payload: {
          kind: "binary_missing",
          message: err instanceof Error ? err.message : "spawn failed",
        },
      };
      return;
    }

    if (hint.promptOnStdin) {
      child.stdin.write(turn.prompt);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    const queue: AgentStreamEvent[] = [];
    let resolver: ((value: AgentStreamEvent | null) => void) | null = null;
    let finished = false;

    const push = (event: AgentStreamEvent): void => {
      if (resolver) {
        const r = resolver;
        resolver = null;
        r(event);
        return;
      }
      queue.push(event);
    };
    const finish = (): void => {
      if (finished) return;
      finished = true;
      if (resolver) {
        const r = resolver;
        resolver = null;
        r(null);
      }
    };

    const onAbort = (): void => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const stdoutHandler = makeChunkHandler(hint.format, push);
    child.stdout.on("data", stdoutHandler);
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      // We surface stderr only when the child exits non-zero (below);
      // here we keep a lightweight tap so the consumer can audit.
      push({ kind: "tool_call", payload: { stream: "stderr", text } });
    });
    child.on("error", (err) => {
      push({
        kind: "error",
        payload: { kind: "binary_missing", message: err.message },
      });
      finish();
    });
    child.on("close", (code) => {
      stdoutHandler.flush();
      push({ kind: "done", payload: { exit_code: code ?? 0 } });
      finish();
    });

    try {
      while (true) {
        if (queue.length > 0) {
          const next = queue.shift();
          if (next) yield next;
          continue;
        }
        if (finished) {
          return;
        }
        const next = await new Promise<AgentStreamEvent | null>((resolve) => {
          resolver = resolve;
        });
        if (!next) {
          return;
        }
        yield next;
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
  }
}

interface ChunkHandler {
  (chunk: Buffer): void;
  flush(): void;
}

function makeChunkHandler(
  format: "ndjson" | "text",
  push: (event: AgentStreamEvent) => void,
): ChunkHandler {
  if (format === "ndjson") {
    let buf = "";
    const handler = ((chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let idx: number;
      // eslint-disable-next-line no-cond-assign
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line.length === 0) continue;
        push(parseNdjsonLine(line));
      }
    }) as ChunkHandler;
    handler.flush = (): void => {
      const line = buf.trim();
      buf = "";
      if (line.length > 0) {
        push(parseNdjsonLine(line));
      }
    };
    return handler;
  }
  const handler = ((chunk: Buffer) => {
    const text = chunk.toString("utf8");
    if (text.length > 0) {
      push({ kind: "token", payload: { text } });
    }
  }) as ChunkHandler;
  handler.flush = (): void => undefined;
  return handler;
}

/**
 * Exported for tests — parse one NDJSON line from a CLI agent.
 * Common shapes:
 *   { "type": "content_block_delta", "delta": { "text": "…" } }
 *   { "type": "message", "content": [{ "type": "text", "text": "…" }] }
 *   { "type": "tool_use", "name": "…", "input": {…} }
 * Anything else falls back to a token event with the raw line.
 */
export function parseNdjsonLine(line: string): AgentStreamEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: "token", payload: { text: line } };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "token", payload: { text: line } };
  }
  const obj = parsed as Record<string, unknown>;
  const type = typeof obj.type === "string" ? obj.type : "";
  if (type === "content_block_delta") {
    const delta = obj.delta as { text?: string } | undefined;
    return { kind: "token", payload: { text: delta?.text ?? "" } };
  }
  if (type === "tool_use") {
    return {
      kind: "tool_call",
      payload: { name: obj.name, input: obj.input },
    };
  }
  if (type === "edit" || type === "edit_proposed") {
    return { kind: "edit_proposed", payload: obj };
  }
  if (typeof obj.text === "string") {
    return { kind: "token", payload: { text: obj.text } };
  }
  if (typeof obj.content === "string") {
    return { kind: "token", payload: { text: obj.content } };
  }
  return { kind: "token", payload: obj };
}

function expandArgs(args: ReadonlyArray<string>, turn: AgentTurn): string[] {
  return args.map((a) => a.replace("${workspaceRoot}", turn.workspaceRoot ?? ""));
}
