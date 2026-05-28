"use strict";
// CLI detection from a terminal's running command line.
//
// We can't introspect arbitrary processes portably (ps/lsof differ per OS,
// proc semantics are macOS-only without sudo for child PIDs, Windows has
// no analogue), so eri's "is claude-code running here?" answer comes from
// the VS Code shell-integration events: when a command starts, we match
// its argv[0] against a small allowlist; when it ends, we clear the
// binding. Anything the user runs inside the same shell session that
// matches `claude` / `codex` / `aider` is then routable from the chat
// composer without making the user pick the terminal.
//
// Detection is intentionally permissive on the binary name (basename
// only) so `~/.local/bin/claude`, `npx claude`, `pnpm dlx codex` and
// `python -m aider` all map correctly.
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectCli = detectCli;
exports.cliLabel = cliLabel;
exports.cliGlyph = cliGlyph;
exports.allCliKinds = allCliKinds;
const ALL_KINDS = ["claude", "codex", "aider"];
/**
 * Inspect a freshly-started command line and return the CLI kind we
 * recognise, or `null` when the command isn't an interesting tool.
 *
 * Matches the basename of the first non-wrapper token, so
 * `pnpm dlx claude --workspace .` → `"claude"`.
 */
function detectCli(command) {
    if (!command)
        return null;
    const tokens = tokenize(command);
    for (const token of tokens) {
        if (isFlag(token)) {
            // Flags fed to a wrapper (e.g. `python -m aider`) — skip past them
            // until we find the actual program being run.
            continue;
        }
        if (isEnvAssignment(token)) {
            // Inline env var assignments (`FOO=1 claude`, `sudo env BAR=2 codex`).
            continue;
        }
        const stripped = stripPath(token);
        if (!stripped)
            continue;
        if (isWrapper(stripped))
            continue;
        const kind = matchKind(stripped);
        if (kind)
            return kind;
        // First real program token isn't one of ours — stop walking so we
        // don't false-positive on arguments that happen to share a name.
        return null;
    }
    return null;
}
function isFlag(token) {
    return token.startsWith("-") || token.startsWith("--");
}
function isEnvAssignment(token) {
    // `NAME=value` style — must start with a letter/underscore and contain '='.
    const eq = token.indexOf("=");
    if (eq <= 0)
        return false;
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(token.slice(0, eq));
}
/** Friendly label for a CLI kind. */
function cliLabel(kind) {
    switch (kind) {
        case "claude":
            return "Claude Code";
        case "codex":
            return "Codex";
        case "aider":
            return "Aider";
    }
}
/** Codicon glyph the tree view uses for terminals that are running a CLI. */
function cliGlyph(kind) {
    switch (kind) {
        case "claude":
            return "sparkle";
        case "codex":
            return "rocket";
        case "aider":
            return "comment-discussion";
    }
}
function allCliKinds() {
    return ALL_KINDS;
}
// --- internals --------------------------------------------------------
function tokenize(command) {
    // We only need rough whitespace tokenisation; the goal is to find the
    // basename of the program being executed, not to faithfully parse a
    // shell line. Strip surrounding quotes so `"claude" --foo` works.
    return command
        .trim()
        .split(/\s+/)
        .map((t) => t.replace(/^["']|["']$/g, ""));
}
function stripPath(token) {
    const slashIdx = Math.max(token.lastIndexOf("/"), token.lastIndexOf("\\"));
    const basename = slashIdx >= 0 ? token.slice(slashIdx + 1) : token;
    // Drop common shebang-style extensions (e.g. `claude.js`, `aider.py`).
    return basename.replace(/\.(js|cjs|mjs|ts|py|sh|exe)$/i, "");
}
const WRAPPERS = new Set([
    "sudo",
    "env",
    "time",
    "nice",
    "npx",
    "pnpm",
    "yarn",
    "bun",
    "deno",
    "uv",
    "uvx",
    "pipx",
    "python",
    "python3",
    "node",
    "bunx",
    "dlx",
    "run",
]);
function isWrapper(name) {
    return WRAPPERS.has(name.toLowerCase());
}
function matchKind(name) {
    const lower = name.toLowerCase();
    if (lower === "claude" || lower === "claude-code" || lower === "claudecode") {
        return "claude";
    }
    if (lower === "codex" || lower === "openai-codex" || lower === "openai") {
        return "codex";
    }
    if (lower === "aider") {
        return "aider";
    }
    return null;
}
//# sourceMappingURL=cliDetect.js.map