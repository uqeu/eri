"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SLASH_COMMANDS = void 0;
exports.activateSlashRegistry = activateSlashRegistry;
const vscode = require("vscode");
/**
 * The 15-command registry — the same list lives in
 * `crates/eri_coreutils/src/services/slash.rs` for the server-side stubs.
 * Keep in sync when adding/removing entries.
 */
exports.SLASH_COMMANDS = [
    {
        key: "ship",
        label: "/ship",
        description: "Builder/Checker tandem ship (Sonnet + GPT-4o + Gemini)",
        placeholder: "what to ship — e.g. refactor src/auth into stateless functions",
        dispatch: {
            kind: "command",
            command: "eri.ship.run",
            argument: (args) => args,
        },
    },
    {
        key: "plan",
        label: "/plan",
        description: "Multi-step plan with the Architect persona",
        placeholder: "goal to plan",
        dispatch: { kind: "sidecarSlash" }, // routed via iterate w/ architect persona client-side
    },
    {
        key: "execute",
        label: "/execute",
        description: "Run the last /plan step-by-step",
        dispatch: { kind: "stub", reason: "Plan execution autopilot — Phase 7b followup" },
    },
    {
        key: "test",
        label: "/test",
        description: "Generate tests with the Tester persona",
        placeholder: "path or current file",
        dispatch: { kind: "sidecarSlash" },
    },
    {
        key: "refactor",
        label: "/refactor",
        description: "Refactor with the Architect persona",
        placeholder: "scope",
        dispatch: { kind: "sidecarSlash" },
    },
    {
        key: "explain",
        label: "/explain",
        description: "Voice-friendly explanation of the current selection",
        dispatch: { kind: "sidecarSlash" },
    },
    {
        key: "recall",
        label: "/recall",
        description: "Search remembered patterns (Phase 8)",
        placeholder: "query",
        dispatch: { kind: "sidecarSlash" },
    },
    {
        key: "remember",
        label: "/remember",
        description: "Pin an explicit memory (Phase 8)",
        placeholder: "fact to remember",
        dispatch: { kind: "sidecarSlash" },
    },
    {
        key: "forget",
        label: "/forget",
        description: "Drop memories (Phase 8)",
        placeholder: "id or 'all'",
        dispatch: { kind: "sidecarSlash" },
    },
    {
        key: "voice",
        label: "/voice",
        description: "Toggle voice capture",
        placeholder: "on | off",
        dispatch: {
            kind: "command",
            command: "eri.toggleMic",
        },
    },
    {
        key: "agent",
        label: "/agent",
        description: "Switch persona (coder, architect, debugger, tester, shipper, mercury, eri)",
        placeholder: "persona name",
        dispatch: { kind: "sidecarSlash" },
    },
    {
        key: "cost",
        label: "/cost",
        description: "Show this session's token spend (Phase 8)",
        dispatch: { kind: "sidecarSlash" },
    },
    {
        key: "quota",
        label: "/quota",
        description: "Show remaining tokens + reset time",
        dispatch: {
            kind: "command",
            command: "eri.account.showStatus",
        },
    },
    {
        key: "learn",
        label: "/learn",
        description: "Enter observation mode (Phase 8)",
        dispatch: { kind: "sidecarSlash" },
    },
    {
        key: "sketch",
        label: "/sketch",
        description: "Mercury-only fast UI mockup from text",
        placeholder: "what to sketch",
        dispatch: { kind: "sidecarSlash" },
    },
    {
        key: "tracer",
        label: "/tracer",
        description: "Clone a repo into a sandbox, index it, answer a query (Nia parity)",
        placeholder: "https://github.com/foo/bar what is the streaming API?",
        dispatch: {
            kind: "command",
            command: "eri.tracer.run",
            argument: (args) => {
                const trimmed = args.trim();
                if (!trimmed)
                    return {};
                const idx = trimmed.search(/\s/);
                if (idx < 0)
                    return { url: trimmed, query: "" };
                return {
                    url: trimmed.slice(0, idx),
                    query: trimmed.slice(idx + 1).trim(),
                };
            },
        },
    },
    {
        key: "document",
        label: "/document",
        description: "Extract text + citations from a PDF or paper URL",
        placeholder: "./paper.pdf or https://arxiv.org/abs/...",
        dispatch: {
            kind: "command",
            command: "eri.document.run",
            argument: (args) => ({ target: args.trim() }),
        },
    },
    {
        key: "new",
        label: "/new",
        description: "Scaffold a starter project from a template",
        placeholder: "template slug — e.g. saas-next, spa-vite, api-rust",
        dispatch: {
            kind: "command",
            command: "eri.templates.scaffold",
            argument: (args) => ({ slug: args.trim() }),
        },
    },
    {
        key: "theme",
        label: "/theme",
        description: "Switch the active theme (or `list` to browse)",
        placeholder: "anthropic | linear | stripe | vercel | …",
        dispatch: {
            kind: "command",
            command: "eri.themes.setActive",
            argument: (args) => ({ slug: args.trim() }),
        },
    },
    {
        key: "preference",
        label: "/preference",
        description: "Set a build preference — `codeStyle.semicolons=false`",
        placeholder: "key.path=value",
        dispatch: { kind: "sidecarSlash" },
    },
];
function activateSlashRegistry(context, getSidecar) {
    const findByKey = (key) => exports.SLASH_COMMANDS.find((c) => c.key === key.toLowerCase());
    const dispatchSlash = async (cmd, args) => {
        const trimmed = args.trim();
        switch (cmd.dispatch.kind) {
            case "command":
                await vscode.commands.executeCommand(cmd.dispatch.command, cmd.dispatch.argument ? cmd.dispatch.argument(trimmed) : trimmed);
                return;
            case "sidecarSlash": {
                // Workspace-scoped slashes need a folder so `.eri/persona` lookups work.
                const folder = vscode.workspace.workspaceFolders?.[0];
                if (!folder) {
                    vscode.window.showWarningMessage(`/${cmd.key} needs an open workspace folder.`);
                    return;
                }
                const sidecar = getSidecar();
                if (!sidecar) {
                    vscode.window.showErrorMessage("Sidecar not running — try again.");
                    return;
                }
                try {
                    const result = await sidecar.request("eri/slash/run", {
                        command: cmd.key,
                        args: trimmed,
                        workspace: folder.uri.fsPath,
                    });
                    if (result.error === "dispatch_client") {
                        // Server says: handle this client-side. For now we fall through
                        // to a stub toast so the user knows the command was recognized
                        // but the iterate-with-persona wiring is pending.
                        vscode.window.showInformationMessage(`/${cmd.key} dispatch is client-side — wiring lands with the next pass.`);
                        return;
                    }
                    if (result.error === "not_implemented") {
                        vscode.window.showInformationMessage(result.message ??
                            `/${cmd.key} lands later (phase ${result.phase ?? "?"}).`);
                        return;
                    }
                    if (result.error === "unknown_persona" || result.error === "unknown_command") {
                        vscode.window.showWarningMessage(result.message ?? `/${cmd.key} failed.`);
                        return;
                    }
                    if (result.message) {
                        vscode.window.showInformationMessage(result.message);
                    }
                }
                catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`/${cmd.key} failed: ${msg}`);
                }
                return;
            }
            case "stub":
                vscode.window.showInformationMessage(`/${cmd.key}: ${cmd.dispatch.reason}`);
                return;
        }
    };
    const tryDispatchFromChat = async (input) => {
        const trimmed = input.trimStart();
        if (!trimmed.startsWith("/")) {
            return false;
        }
        const space = trimmed.indexOf(" ");
        const key = (space === -1 ? trimmed.slice(1) : trimmed.slice(1, space)).toLowerCase();
        const args = space === -1 ? "" : trimmed.slice(space + 1);
        const cmd = findByKey(key);
        if (!cmd) {
            return false;
        }
        await dispatchSlash(cmd, args);
        return true;
    };
    const showPicker = async () => {
        const items = exports.SLASH_COMMANDS.map((c) => ({
            label: c.label,
            description: c.description,
            key: c.key,
        }));
        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: "Pick a slash command",
            matchOnDescription: true,
        });
        if (!pick) {
            return;
        }
        const cmd = findByKey(pick.key);
        if (!cmd) {
            return;
        }
        let args = "";
        if (cmd.placeholder) {
            const input = await vscode.window.showInputBox({
                prompt: cmd.label,
                placeHolder: cmd.placeholder,
                ignoreFocusOut: true,
            });
            if (input === undefined) {
                return;
            }
            args = input;
        }
        await dispatchSlash(cmd, args);
    };
    context.subscriptions.push(vscode.commands.registerCommand("eri.slash.pick", showPicker), vscode.commands.registerCommand("eri.slash.run", async (input) => {
        if (typeof input === "string" && input.length > 0) {
            const matched = await tryDispatchFromChat(input);
            if (!matched) {
                vscode.window.showWarningMessage(`Unknown slash command: ${input}`);
            }
            return;
        }
        await showPicker();
    }));
    // Per-command palette entries: `eri.slash.ship`, `eri.slash.plan`, etc.
    for (const cmd of exports.SLASH_COMMANDS) {
        const id = `eri.slash.${cmd.key}`;
        context.subscriptions.push(vscode.commands.registerCommand(id, async () => {
            let args = "";
            if (cmd.placeholder) {
                const input = await vscode.window.showInputBox({
                    prompt: cmd.label,
                    placeHolder: cmd.placeholder,
                    ignoreFocusOut: true,
                });
                if (input === undefined) {
                    return;
                }
                args = input;
            }
            await dispatchSlash(cmd, args);
        }));
    }
    return {
        tryDispatchFromChat,
        showPicker,
        dispose: () => {
            // Commands are disposed via context.subscriptions.
        },
    };
}
//# sourceMappingURL=registry.js.map