"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sidecar = void 0;
exports.resolveBinaryPath = resolveBinaryPath;
const child_process_1 = require("child_process");
const path = require("path");
const vscode = require("vscode");
const CONTENT_LENGTH_RE = /^Content-Length:\s*(\d+)/i;
class Sidecar {
    options;
    childProcess = null;
    buffer = Buffer.alloc(0);
    nextId = 1;
    pending = new Map();
    requestHandler;
    constructor(options) {
        this.options = options;
        this.requestHandler = options.onRequest ?? null;
    }
    setRequestHandler(handler) {
        this.requestHandler = handler;
    }
    start() {
        if (this.childProcess) {
            return;
        }
        // Uses spawn with a fixed binary path and no shell — no command injection surface.
        this.childProcess = (0, child_process_1.spawn)(this.options.binaryPath, [], {
            stdio: ["pipe", "pipe", "pipe"],
            shell: false,
        });
        this.childProcess.stdout.on("data", (chunk) => this.handleStdoutChunk(chunk));
        this.childProcess.stderr.on("data", (chunk) => {
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
    stop() {
        this.childProcess?.kill();
        this.childProcess = null;
    }
    async request(method, params = {}) {
        if (!this.childProcess) {
            throw new Error("sidecar not running");
        }
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, {
                resolve: (value) => resolve(value),
                reject,
            });
            this.write({ jsonrpc: "2.0", id, method, params });
        });
    }
    notify(method, params = {}) {
        if (!this.childProcess) {
            return;
        }
        this.write({ jsonrpc: "2.0", method, params });
    }
    write(message) {
        if (!this.childProcess) {
            return;
        }
        const body = Buffer.from(JSON.stringify(message), "utf8");
        const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
        this.childProcess.stdin.write(Buffer.concat([header, body]));
    }
    handleStdoutChunk(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.tryDrainMessage()) {
            // keep draining
        }
    }
    tryDrainMessage() {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) {
            return false;
        }
        const headerText = this.buffer.slice(0, headerEnd).toString("ascii");
        let contentLength = null;
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
        }
        catch (err) {
            console.error("[eri-coreutils] failed to parse message", err);
        }
        return true;
    }
    dispatchIncoming(message) {
        const hasId = typeof message.id === "number" || typeof message.id === "string";
        const hasMethod = typeof message.method === "string";
        // Sidecar -> extension request (has both id and method). We respond
        // with a JSON-RPC result/error.
        if (hasId && hasMethod) {
            const id = message.id;
            const method = message.method;
            const params = message.params ?? {};
            void this.handleIncomingRequest({ id, method, params });
            return;
        }
        // Response to a request the extension made.
        if (hasId && typeof message.id === "number") {
            const pending = this.pending.get(message.id);
            if (!pending) {
                return;
            }
            this.pending.delete(message.id);
            if (message.error) {
                pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
            }
            else {
                pending.resolve(message.result);
            }
            return;
        }
        // Notification from sidecar.
        if (hasMethod) {
            this.options.onNotification({
                method: message.method,
                params: message.params ?? {},
            });
        }
    }
    async handleIncomingRequest(request) {
        const handler = this.requestHandler;
        if (!handler) {
            this.write({
                jsonrpc: "2.0",
                id: request.id,
                error: { code: -32601, message: "method not found" },
            });
            return;
        }
        try {
            const result = await handler(request);
            this.write({ jsonrpc: "2.0", id: request.id, result: result ?? null });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "internal error";
            this.write({
                jsonrpc: "2.0",
                id: request.id,
                error: { code: -32603, message },
            });
        }
    }
}
exports.Sidecar = Sidecar;
function resolveBinaryPath(context) {
    const override = vscode.workspace
        .getConfiguration("eri")
        .get("coreutilsPath");
    if (override && override.trim().length > 0) {
        return override;
    }
    return path.join(context.extensionUri.fsPath, "..", "..", "resources", "bin", process.platform === "win32" ? "eri-coreutils.exe" : "eri-coreutils");
}
//# sourceMappingURL=sidecar.js.map