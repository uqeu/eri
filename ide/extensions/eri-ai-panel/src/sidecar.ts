import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import * as path from "path";
import * as vscode from "vscode";

const CONTENT_LENGTH_RE = /^Content-Length:\s*(\d+)/i;

export interface SidecarNotification {
  method: string;
  params: unknown;
}

export interface SidecarOptions {
  binaryPath: string;
  onNotification: (notification: SidecarNotification) => void;
  onExit: (code: number | null) => void;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export class Sidecar {
  private childProcess: ChildProcessWithoutNullStreams | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(private readonly options: SidecarOptions) {}

  start(): void {
    if (this.childProcess) {
      return;
    }
    // Uses spawn with a fixed binary path and no shell — no command injection surface.
    this.childProcess = spawn(this.options.binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    this.childProcess.stdout.on("data", (chunk: Buffer) => this.handleStdoutChunk(chunk));
    this.childProcess.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text.length > 0) {
        console.warn("[eri-coreutils]", text);
      }
    });
    this.childProcess.on("exit", (code) => {
      this.childProcess = null;
      for (const pending of this.pending.values()) {
        pending.reject(new Error("sidecar exited"));
      }
      this.pending.clear();
      this.options.onExit(code);
    });
  }

  stop(): void {
    this.childProcess?.kill();
    this.childProcess = null;
  }

  async request<T>(method: string, params: unknown = {}): Promise<T> {
    if (!this.childProcess) {
      throw new Error("sidecar not running");
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown = {}): void {
    if (!this.childProcess) {
      return;
    }
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(message: object): void {
    if (!this.childProcess) {
      return;
    }
    const body = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
    this.childProcess.stdin.write(Buffer.concat([header, body]));
  }

  private handleStdoutChunk(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.tryDrainMessage()) {
      // keep draining
    }
  }

  private tryDrainMessage(): boolean {
    const headerEnd = this.buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return false;
    }
    const headerText = this.buffer.slice(0, headerEnd).toString("ascii");
    let contentLength: number | null = null;
    for (const line of headerText.split("\r\n")) {
      const match = CONTENT_LENGTH_RE.exec(line);
      if (match) {
        contentLength = parseInt(match[1], 10);
        break;
      }
    }
    if (contentLength === null) {
      this.buffer = this.buffer.slice(headerEnd + 4);
      return true;
    }
    const bodyStart = headerEnd + 4;
    if (this.buffer.length < bodyStart + contentLength) {
      return false;
    }
    const body = this.buffer.slice(bodyStart, bodyStart + contentLength);
    this.buffer = this.buffer.slice(bodyStart + contentLength);
    try {
      const message = JSON.parse(body.toString("utf8"));
      this.dispatchIncoming(message);
    } catch (err) {
      console.error("[eri-coreutils] failed to parse message", err);
    }
    return true;
  }

  private dispatchIncoming(message: {
    id?: number;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: { code: number; message: string };
  }): void {
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (typeof message.method === "string") {
      this.options.onNotification({
        method: message.method,
        params: message.params ?? {},
      });
    }
  }
}

export function resolveBinaryPath(context: vscode.ExtensionContext): string {
  const override = vscode.workspace
    .getConfiguration("eri")
    .get<string>("coreutilsPath");
  if (override && override.trim().length > 0) {
    return override;
  }
  return path.join(
    context.extensionUri.fsPath,
    "..",
    "..",
    "resources",
    "bin",
    process.platform === "win32" ? "eri-coreutils.exe" : "eri-coreutils",
  );
}
