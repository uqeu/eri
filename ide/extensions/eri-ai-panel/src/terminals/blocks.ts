// Warp-style "block" capture: each completed shell command becomes an
// addressable record with its command line, output, exit code, duration.
//
// Requires VS Code shell integration (1.85+). When unavailable, the
// capture is silently a no-op — the rest of the module still works.

import * as vscode from "vscode";
import { AuditSink, makeEvent } from "./auditLog";

export interface TerminalBlock {
  readonly id: string;
  readonly terminalKey: string;
  readonly command: string;
  readonly output: string;
  readonly exitCode: number | null;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly durationMs: number;
}

const MAX_BLOCKS_IN_MEMORY = 200;
const MAX_BLOCKS_PERSISTED = 50;
const MAX_OUTPUT_BYTES_PER_TERMINAL = 200 * 1024;
const STORAGE_KEY = "eri.terminals.blocks";

export interface BlockSubscriber {
  (terminalKey: string, block: TerminalBlock): void;
}

interface StoredShape {
  readonly version: number;
  readonly perTerminal: Record<string, TerminalBlock[]>;
}

export class BlockStore {
  private readonly perTerminal = new Map<string, TerminalBlock[]>();
  private readonly subscribers = new Set<BlockSubscriber>();
  private readonly emitter = new vscode.EventEmitter<string>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly memento: vscode.Memento) {
    this.restore();
  }

  list(terminalKey: string, limit = 30): ReadonlyArray<TerminalBlock> {
    const blocks = this.perTerminal.get(terminalKey) ?? [];
    return blocks.slice(-limit).reverse();
  }

  allTerminals(): ReadonlyArray<string> {
    return [...this.perTerminal.keys()];
  }

  // Returns the latest block list across all terminals, newest first.
  flatten(limit = 200): ReadonlyArray<TerminalBlock> {
    const all: TerminalBlock[] = [];
    for (const list of this.perTerminal.values()) {
      all.push(...list);
    }
    all.sort((a, b) => b.endedAtMs - a.endedAtMs);
    return all.slice(0, limit);
  }

  subscribe(handler: BlockSubscriber): vscode.Disposable {
    this.subscribers.add(handler);
    return { dispose: () => this.subscribers.delete(handler) };
  }

  push(terminalKey: string, block: TerminalBlock): void {
    const current = this.perTerminal.get(terminalKey) ?? [];
    const next = [...current, block];
    while (next.length > MAX_BLOCKS_IN_MEMORY) {
      next.shift();
    }
    // Trim by total output bytes (oldest first).
    let totalBytes = next.reduce(
      (sum, b) => sum + Buffer.byteLength(b.output, "utf8"),
      0,
    );
    while (next.length > 1 && totalBytes > MAX_OUTPUT_BYTES_PER_TERMINAL) {
      const dropped = next.shift();
      if (dropped) {
        totalBytes -= Buffer.byteLength(dropped.output, "utf8");
      }
    }
    this.perTerminal.set(terminalKey, next);
    void this.persist();
    this.emitter.fire(terminalKey);
    for (const sub of this.subscribers) {
      try {
        sub(terminalKey, block);
      } catch {
        // Subscriber errors must not break the store.
      }
    }
  }

  reassignTerminalKey(oldKey: string, newKey: string): void {
    if (oldKey === newKey) {
      return;
    }
    const blocks = this.perTerminal.get(oldKey);
    if (!blocks) {
      return;
    }
    this.perTerminal.delete(oldKey);
    this.perTerminal.set(
      newKey,
      blocks.map((b) => ({ ...b, terminalKey: newKey })),
    );
    void this.persist();
  }

  clearTerminal(terminalKey: string): void {
    this.perTerminal.delete(terminalKey);
    void this.persist();
    this.emitter.fire(terminalKey);
  }

  dispose(): void {
    this.subscribers.clear();
    this.emitter.dispose();
  }

  private restore(): void {
    const raw = this.memento.get<StoredShape>(STORAGE_KEY);
    if (!raw || typeof raw !== "object" || !raw.perTerminal) {
      return;
    }
    for (const [key, list] of Object.entries(raw.perTerminal)) {
      if (Array.isArray(list)) {
        this.perTerminal.set(
          key,
          list.filter((b): b is TerminalBlock => isValidBlock(b)),
        );
      }
    }
  }

  private async persist(): Promise<void> {
    const trimmed: Record<string, TerminalBlock[]> = {};
    for (const [key, list] of this.perTerminal) {
      trimmed[key] = list.slice(-MAX_BLOCKS_PERSISTED);
    }
    const stored: StoredShape = { version: 1, perTerminal: trimmed };
    await this.memento.update(STORAGE_KEY, stored);
  }
}

function isValidBlock(value: unknown): value is TerminalBlock {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<TerminalBlock>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.terminalKey === "string" &&
    typeof candidate.command === "string" &&
    typeof candidate.output === "string"
  );
}

// Wires shell integration to push blocks into the store.
export class BlockCapture {
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly store: BlockStore,
    private readonly resolveKey: (
      terminal: vscode.Terminal,
    ) => string | undefined,
    private readonly audit: AuditSink,
  ) {
    this.disposables.push(
      vscode.window.onDidStartTerminalShellExecution((event) =>
        this.handleStart(event),
      ),
      vscode.window.onDidEndTerminalShellExecution((event) =>
        this.handleEnd(event),
      ),
    );
  }

  private readonly inflight = new Map<
    vscode.Terminal,
    { startedAtMs: number; output: string }
  >();

  private handleStart(event: vscode.TerminalShellExecutionStartEvent): void {
    const buffer: { startedAtMs: number; output: string } = {
      startedAtMs: Date.now(),
      output: "",
    };
    this.inflight.set(event.terminal, buffer);
    void this.consumeStream(event, buffer);
  }

  private async consumeStream(
    event: vscode.TerminalShellExecutionStartEvent,
    buffer: { output: string },
  ): Promise<void> {
    try {
      const stream = event.execution.read();
      for await (const chunk of stream) {
        buffer.output += stripAnsi(chunk);
        if (buffer.output.length > MAX_OUTPUT_BYTES_PER_TERMINAL) {
          buffer.output =
            buffer.output.slice(-MAX_OUTPUT_BYTES_PER_TERMINAL) +
            "\n…(truncated)";
        }
      }
    } catch {
      // Stream interrupted — keep whatever output we already buffered.
    }
  }

  private handleEnd(event: vscode.TerminalShellExecutionEndEvent): void {
    const buffer = this.inflight.get(event.terminal);
    this.inflight.delete(event.terminal);
    const key = this.resolveKey(event.terminal);
    if (!key) {
      return;
    }
    const startedAtMs = buffer?.startedAtMs ?? Date.now();
    const endedAtMs = Date.now();
    const commandLine = event.execution.commandLine?.value ?? "";
    if (!commandLine) {
      return;
    }
    const block: TerminalBlock = {
      id: `b_${endedAtMs.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      terminalKey: key,
      command: commandLine,
      output: buffer?.output ?? "",
      exitCode: typeof event.exitCode === "number" ? event.exitCode : null,
      startedAtMs,
      endedAtMs,
      durationMs: endedAtMs - startedAtMs,
    };
    this.store.push(key, block);
    void this.audit.append(
      makeEvent("block.captured", {
        terminal: key,
        command: commandLine,
        exitCode: block.exitCode,
        durationMs: block.durationMs,
      }),
    );
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.inflight.clear();
  }
}

// Strip common ANSI escape sequences from terminal output.
export function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\[[0-9;?]*[ -/]*[@-~]/g, "");
}
