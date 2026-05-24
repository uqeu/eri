"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CliAgent = void 0;
exports.parseNdjsonLine = parseNdjsonLine;
const child_process_1 = require("child_process");
const path = require("path");
const builtins_1 = require("./builtins");
class CliAgent {
    opts;
    constructor(opts) {
        this.opts = opts;
    }
    async *run(descriptor, turn, signal) {
        if (!descriptor.binary || descriptor.binary.length === 0) {
            yield {
                kind: "error",
                payload: { kind: "binary_missing", message: "no binary configured" },
            };
            return;
        }
        const args = expandArgs(descriptor.binaryArgs ?? [], turn);
        const hint = (0, builtins_1.cliParserHint)(path.basename(descriptor.binary));
        // Build sanitized env (drop blocklisted secrets).
        const env = {};
        for (const [key, value] of Object.entries(process.env)) {
            if (value === undefined)
                continue;
            if (this.opts.envBlocklist.includes(key))
                continue;
            env[key] = value;
        }
        let child;
        try {
            const finalArgs = hint.promptOnStdin ? args : [...args, turn.prompt];
            child = (0, child_process_1.spawn)(descriptor.binary, finalArgs, {
                cwd: turn.workspaceRoot,
                env,
                stdio: ["pipe", "pipe", "pipe"],
            });
        }
        catch (err) {
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
        }
        else {
            child.stdin.end();
        }
        const queue = [];
        let resolver = null;
        let finished = false;
        const push = (event) => {
            if (resolver) {
                const r = resolver;
                resolver = null;
                r(event);
                return;
            }
            queue.push(event);
        };
        const finish = () => {
            if (finished)
                return;
            finished = true;
            if (resolver) {
                const r = resolver;
                resolver = null;
                r(null);
            }
        };
        const onAbort = () => {
            if (!child.killed) {
                child.kill("SIGTERM");
            }
        };
        if (signal.aborted) {
            onAbort();
        }
        else {
            signal.addEventListener("abort", onAbort, { once: true });
        }
        const stdoutHandler = makeChunkHandler(hint.format, push);
        child.stdout.on("data", stdoutHandler);
        child.stderr.on("data", (chunk) => {
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
                    if (next)
                        yield next;
                    continue;
                }
                if (finished) {
                    return;
                }
                const next = await new Promise((resolve) => {
                    resolver = resolve;
                });
                if (!next) {
                    return;
                }
                yield next;
            }
        }
        finally {
            signal.removeEventListener("abort", onAbort);
            if (!child.killed) {
                child.kill("SIGTERM");
            }
        }
    }
}
exports.CliAgent = CliAgent;
function makeChunkHandler(format, push) {
    if (format === "ndjson") {
        let buf = "";
        const handler = ((chunk) => {
            buf += chunk.toString("utf8");
            let idx;
            // eslint-disable-next-line no-cond-assign
            while ((idx = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, idx).trim();
                buf = buf.slice(idx + 1);
                if (line.length === 0)
                    continue;
                push(parseNdjsonLine(line));
            }
        });
        handler.flush = () => {
            const line = buf.trim();
            buf = "";
            if (line.length > 0) {
                push(parseNdjsonLine(line));
            }
        };
        return handler;
    }
    const handler = ((chunk) => {
        const text = chunk.toString("utf8");
        if (text.length > 0) {
            push({ kind: "token", payload: { text } });
        }
    });
    handler.flush = () => undefined;
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
function parseNdjsonLine(line) {
    let parsed;
    try {
        parsed = JSON.parse(line);
    }
    catch {
        return { kind: "token", payload: { text: line } };
    }
    if (typeof parsed !== "object" || parsed === null) {
        return { kind: "token", payload: { text: line } };
    }
    const obj = parsed;
    const type = typeof obj.type === "string" ? obj.type : "";
    if (type === "content_block_delta") {
        const delta = obj.delta;
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
function expandArgs(args, turn) {
    return args.map((a) => a.replace("${workspaceRoot}", turn.workspaceRoot ?? ""));
}
//# sourceMappingURL=cliAgent.js.map