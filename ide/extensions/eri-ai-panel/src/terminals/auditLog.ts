// Local-only, append-only audit log. One JSON object per line. Never
// transmitted off-machine. Survives restart; safe under concurrent writes
// because we serialize through a per-process write queue.

import * as fs from "node:fs/promises";
import * as path from "node:path";

export type AuditEventKind =
  | "terminal.spawn"
  | "terminal.kill"
  | "terminal.rename"
  | "terminal.lock"
  | "group.create"
  | "group.remove"
  | "group.rename"
  | "block.captured"
  | "block.sentToChat"
  | "layout.save"
  | "layout.restore"
  | "layout.delete"
  | "layout.preset.quad"
  | "terminal.routedToCli";

export interface AuditEvent {
  readonly kind: AuditEventKind;
  readonly at: string;
  readonly data: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AuditSink {
  append(event: AuditEvent): Promise<void>;
  dispose(): void;
}

// JSONL writer with a single-flight queue. Safe under concurrent append
// because all writes are serialized through `queue`.
export class FileAuditSink implements AuditSink {
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly filePath: string) {}

  append(event: AuditEvent): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    const line = `${JSON.stringify(event)}\n`;
    const next = this.queue.then(() => this.write(line)).catch(() => undefined);
    this.queue = next;
    return next;
  }

  private async write(line: string): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, line, { encoding: "utf8" });
  }

  dispose(): void {
    this.disposed = true;
  }
}

// In-memory sink (tests / no-workspace fallback).
export class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  append(event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  dispose(): void {
    this.events.length = 0;
  }
}

export function makeEvent(
  kind: AuditEventKind,
  data: AuditEvent["data"],
): AuditEvent {
  return {
    kind,
    at: new Date().toISOString(),
    data,
  };
}
