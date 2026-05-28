"use strict";
// Command registrations for the eri.terminals view. Each command is small;
// orchestration belongs to TerminalsRuntime and the various stores.
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTerminalCommands = registerTerminalCommands;
exports.sendBlockToChat = sendBlockToChat;
exports.rerunBlock = rerunBlock;
exports.selectionForBlock = selectionForBlock;
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
const state_1 = require("./state");
const layouts_1 = require("./layouts");
const auditLog_1 = require("./auditLog");
const cliDetect_1 = require("./cliDetect");
const ICON_CHOICES = [
    "terminal",
    "rocket",
    "beaker",
    "database",
    "globe",
    "package",
    "server",
    "tools",
    "zap",
    "play",
    "settings-gear",
];
function registerTerminalCommands(deps) {
    const subs = [];
    subs.push(vscode.commands.registerCommand("eri.terminals.reveal", (key) => {
        const terminal = deps.runtime.resolveTerminal(key);
        terminal?.show();
        const snapshot = deps.store.current();
        const record = snapshot.terminals.find((t) => t.key === key);
        deps.blocksView.focus({
            terminalKey: key,
            terminalName: record?.name ?? "(unknown)",
        });
    }), vscode.commands.registerCommand("eri.terminals.newGroup", async () => {
        const name = await vscode.window.showInputBox({
            prompt: "Group name",
            placeHolder: "e.g. Frontend",
            validateInput: (value) => value.trim().length === 0 ? "Name required" : undefined,
        });
        if (!name) {
            return;
        }
        await deps.runtime.createGroup(name.trim());
    }), vscode.commands.registerCommand("eri.terminals.renameGroup", async (node) => {
        if (!node || node.kind !== "group") {
            return;
        }
        const next = await vscode.window.showInputBox({
            prompt: "Rename group",
            value: node.group.name,
        });
        if (!next || next === node.group.name) {
            return;
        }
        await deps.runtime.renameGroup(node.group.id, next.trim());
    }), vscode.commands.registerCommand("eri.terminals.removeGroup", async (node) => {
        if (!node || node.kind !== "group") {
            return;
        }
        const ok = await vscode.window.showWarningMessage(`Remove group "${node.group.name}"? Terminals inside will move to another group.`, { modal: true }, "Remove");
        if (ok !== "Remove") {
            return;
        }
        await deps.runtime.removeGroup(node.group.id);
    }), vscode.commands.registerCommand("eri.terminals.setGroupIcon", async (node) => {
        if (!node || node.kind !== "group") {
            return;
        }
        const choice = await vscode.window.showQuickPick(ICON_CHOICES, {
            placeHolder: "Pick an icon",
        });
        if (!choice) {
            return;
        }
        const snapshot = deps.store.current();
        await deps.store.apply((0, state_1.updateGroup)(snapshot, node.group.id, { icon: choice }));
    }), vscode.commands.registerCommand("eri.terminals.rename", async (node) => {
        if (!node || node.kind !== "terminal") {
            return;
        }
        const next = await vscode.window.showInputBox({
            prompt: "Rename terminal (also locks the name)",
            value: node.record.name,
        });
        if (!next || next === node.record.name) {
            return;
        }
        const snapshot = deps.store.current();
        await deps.store.apply((0, state_1.upsertTerminal)(snapshot, {
            ...node.record,
            name: next.trim(),
            nameLocked: true,
        }));
        void deps.audit.append((0, auditLog_1.makeEvent)("terminal.rename", {
            key: node.record.key,
            from: node.record.name,
            to: next.trim(),
            auto: false,
        }));
    }), vscode.commands.registerCommand("eri.terminals.toggleLock", async (node) => {
        if (!node || node.kind !== "terminal") {
            return;
        }
        const snapshot = deps.store.current();
        const next = !node.record.nameLocked;
        await deps.store.apply((0, state_1.upsertTerminal)(snapshot, { ...node.record, nameLocked: next }));
        void deps.audit.append((0, auditLog_1.makeEvent)("terminal.lock", {
            key: node.record.key,
            locked: next,
        }));
    }), vscode.commands.registerCommand("eri.terminals.kill", async (node) => {
        if (!node || node.kind !== "terminal") {
            return;
        }
        const terminal = deps.runtime.resolveTerminal(node.record.key);
        terminal?.dispose();
    }), vscode.commands.registerCommand("eri.terminals.duplicate", async (node) => {
        if (!node || node.kind !== "terminal") {
            return;
        }
        const cwd = node.record.cwd ?? deps.workspaceFsPath;
        const terminal = vscode.window.createTerminal({
            name: node.record.name,
            cwd,
        });
        terminal.show();
    }), vscode.commands.registerCommand("eri.terminals.moveToGroup", async (node) => {
        if (!node || node.kind !== "terminal") {
            return;
        }
        const snapshot = deps.store.current();
        const pick = await vscode.window.showQuickPick([
            ...snapshot.groups.map((g) => ({
                label: g.name,
                description: g.cwd ?? "",
                groupId: g.id,
            })),
            { label: "$(add) New group…", description: "", groupId: "__new__" },
        ], { placeHolder: "Move to group" });
        if (!pick) {
            return;
        }
        let targetId = pick.groupId;
        if (targetId === "__new__") {
            const name = await vscode.window.showInputBox({
                prompt: "New group name",
            });
            if (!name) {
                return;
            }
            targetId = await deps.runtime.createGroup(name.trim());
        }
        const snap = deps.store.current();
        await deps.store.apply((0, state_1.upsertTerminal)(snap, { ...node.record, groupId: targetId }));
    }), vscode.commands.registerCommand("eri.terminals.spawnInGroup", async () => spawnInGroupCommand(deps)), vscode.commands.registerCommand("eri.terminals.findCommand", async () => findCommandQuickPick(deps)), vscode.commands.registerCommand("eri.terminals.saveLayout", async () => saveLayoutCommand(deps)), vscode.commands.registerCommand("eri.terminals.restoreLayout", async (filePathOrNode) => restoreLayoutCommand(deps, filePathOrNode)), vscode.commands.registerCommand("eri.terminals.deleteLayout", async (node) => {
        if (!node || node.kind !== "layout") {
            return;
        }
        const ok = await vscode.window.showWarningMessage(`Delete layout "${node.layout.name}"?`, { modal: true }, "Delete");
        if (ok !== "Delete") {
            return;
        }
        await (0, layouts_1.deleteLayout)(node.layout.filePath);
        void deps.audit.append((0, auditLog_1.makeEvent)("layout.delete", { name: node.layout.name }));
        await deps.refreshLayouts();
    }), vscode.commands.registerCommand("eri.terminals.openRecipe", async () => openRecipeCommand(deps)), vscode.commands.registerCommand("eri.terminals.layoutQuad", async () => layoutQuadCommand(deps)), vscode.commands.registerCommand("eri.terminals.routeToCli", async (kind, prompt) => routeToCliCommand(deps, kind, prompt)));
    return vscode.Disposable.from(...subs);
}
// Helpers -----------------------------------------------------------------
async function spawnInGroupCommand(deps) {
    const snapshot = deps.store.current();
    const groupPick = await vscode.window.showQuickPick([
        ...snapshot.groups.map((g) => ({
            label: g.name,
            description: g.cwd ?? "",
            groupId: g.id,
            cwd: g.cwd,
        })),
        {
            label: "$(add) New group…",
            description: "",
            groupId: "__new__",
            cwd: undefined,
        },
    ], { placeHolder: "Spawn in group" });
    if (!groupPick) {
        return;
    }
    let groupId = groupPick.groupId;
    let cwd = groupPick.cwd;
    if (groupId === "__new__") {
        const name = await vscode.window.showInputBox({
            prompt: "New group name",
        });
        if (!name) {
            return;
        }
        groupId = await deps.runtime.createGroup(name.trim());
    }
    cwd = cwd ?? deps.workspaceFsPath;
    const cmd = await vscode.window.showInputBox({
        prompt: "Command to run (leave blank for empty shell)",
    });
    const terminal = vscode.window.createTerminal({ cwd });
    terminal.show();
    if (cmd && cmd.trim().length > 0) {
        terminal.sendText(cmd, true);
    }
    // Bind to chosen group on next adopt tick.
    setTimeout(() => {
        const live = deps.runtime.resolveKey(terminal);
        if (!live) {
            return;
        }
        const snap = deps.store.current();
        const record = snap.terminals.find((t) => t.key === live);
        if (!record) {
            return;
        }
        void deps.store.apply((0, state_1.upsertTerminal)(snap, { ...record, groupId }));
    }, 250);
}
/**
 * 4-pane quad layout — opens a fresh group named "Quad", spawns four
 * terminals in it, and splits the editor area so they sit in a 2×2 grid.
 * The user can then drop CLIs into each pane (`claude` top-left,
 * `codex` top-right, ad-hoc shell bottom-left, log tail bottom-right is
 * the canonical "agent control room" arrangement we recommend).
 */
async function layoutQuadCommand(deps) {
    const cwd = deps.workspaceFsPath;
    const groupId = await deps.runtime.createGroup("Quad", "grid");
    // VS Code's terminal splitter operates on the currently-focused terminal,
    // so spawn → focus → split sequentially. Use small awaits so the events
    // settle before we issue the next layout command.
    const created = [];
    for (let i = 0; i < 4; i++) {
        const t = vscode.window.createTerminal({ name: `Quad ${i + 1}`, cwd });
        created.push(t);
        t.show();
        if (i === 1) {
            // Right of pane 1.
            await vscode.commands.executeCommand("workbench.action.terminal.splitInActiveWorkspace");
        }
        else if (i === 2 || i === 3) {
            // Split below the previously-focused pane (rotates between
            // bottom-left and bottom-right when the user has moved focus
            // manually — close enough for the preset).
            await vscode.commands.executeCommand("workbench.action.terminal.split");
        }
        // Small breathing room for shell integration to bind so the runtime
        // adopt callback associates the right group id below.
        await new Promise((resolve) => setTimeout(resolve, 60));
    }
    // Move each freshly-created terminal into the Quad group.
    setTimeout(() => {
        for (const t of created) {
            const key = deps.runtime.resolveKey(t);
            if (!key)
                continue;
            const snap = deps.store.current();
            const record = snap.terminals.find((r) => r.key === key);
            if (!record || record.groupId === groupId)
                continue;
            void deps.store.apply((0, state_1.upsertTerminal)(snap, { ...record, groupId }));
        }
    }, 300);
    void deps.audit.append((0, auditLog_1.makeEvent)("layout.preset.quad", { groupId, count: created.length }));
}
/**
 * Pipe a prompt into the terminal currently running the requested CLI.
 * Returns `true` when a matching terminal was found (and the prompt was
 * sent). Callers (the chat composer / slash dispatcher) use this to avoid
 * spawning a fresh subprocess when the user already has `claude` /
 * `codex` / `aider` running in a terminal.
 *
 * When no matching terminal exists, this is a no-op so the caller can
 * fall back to spawning. We deliberately do NOT spawn from here — the
 * spawn path lives in the CliAgent backend and has different lifecycle
 * semantics (process ownership, stdio piping, etc).
 */
async function routeToCliCommand(deps, kind, prompt) {
    if (!kind || !prompt) {
        return false;
    }
    const terminal = deps.runtime.findCliTerminal(kind);
    if (!terminal) {
        return false;
    }
    terminal.show(true);
    terminal.sendText(prompt, true);
    void deps.audit.append((0, auditLog_1.makeEvent)("terminal.routedToCli", {
        kind,
        terminalName: terminal.name,
        promptLen: prompt.length,
    }));
    vscode.window.setStatusBarMessage(`routed to ${(0, cliDetect_1.cliLabel)(kind)} in ${terminal.name}`, 2_500);
    return true;
}
async function findCommandQuickPick(deps) {
    const all = deps.blocks.flatten(500);
    if (all.length === 0) {
        vscode.window.showInformationMessage("No captured commands yet — run something with shell integration enabled.");
        return;
    }
    const snapshot = deps.store.current();
    const items = all.map((block) => {
        const owner = snapshot.terminals.find((t) => t.key === block.terminalKey);
        const exit = block.exitCode === 0
            ? "✓"
            : block.exitCode === null
                ? "…"
                : `✗${block.exitCode}`;
        return {
            label: block.command,
            description: `${exit} · ${owner?.name ?? "(closed)"} · ${new Date(block.endedAtMs).toLocaleTimeString()}`,
            block,
        };
    });
    const pick = await vscode.window.showQuickPick(items, {
        placeHolder: "Search captured commands",
        matchOnDescription: true,
    });
    if (!pick) {
        return;
    }
    await vscode.env.clipboard.writeText(pick.block.command);
    vscode.window.setStatusBarMessage("Command copied to clipboard", 2000);
}
async function saveLayoutCommand(deps) {
    if (!deps.workspaceFsPath) {
        vscode.window.showWarningMessage("Open a workspace before saving terminal layouts.");
        return;
    }
    const name = await vscode.window.showInputBox({
        prompt: "Layout name",
        placeHolder: "e.g. Frontend dev",
    });
    if (!name) {
        return;
    }
    const snapshot = deps.store.current();
    const layout = {
        name: name.trim(),
        groups: snapshot.groups.map((group) => ({
            name: group.name,
            icon: group.icon,
            terminals: snapshot.terminals
                .filter((t) => t.groupId === group.id)
                .map((t) => {
                const lastCommand = deps.runtime.lastCommand(t.key);
                return {
                    name: t.name,
                    cwd: t.cwd ?? "",
                    command: lastCommand ?? undefined,
                    icon: t.icon,
                };
            }),
        })),
    };
    const filePath = await (0, layouts_1.writeLayout)(deps.workspaceFsPath, layout);
    void deps.audit.append((0, auditLog_1.makeEvent)("layout.save", { name: layout.name, path: filePath }));
    await deps.refreshLayouts();
    vscode.window.showInformationMessage(`Layout saved: ${filePath}`);
}
async function restoreLayoutCommand(deps, arg) {
    if (!deps.workspaceFsPath) {
        vscode.window.showWarningMessage("Open a workspace before restoring layouts.");
        return;
    }
    let target;
    if (typeof arg === "string") {
        target = { name: path.basename(arg, ".json"), filePath: arg };
    }
    else if (arg && arg.kind === "layout") {
        target = arg.layout;
    }
    else {
        const layouts = await (0, layouts_1.listLayouts)(deps.workspaceFsPath);
        const pick = await vscode.window.showQuickPick(layouts.map((l) => ({ label: l.name, layout: l })), { placeHolder: "Restore which layout?" });
        target = pick?.layout;
    }
    if (!target) {
        return;
    }
    const layout = await (0, layouts_1.readLayout)(target.filePath);
    if (!layout) {
        vscode.window.showErrorMessage("Could not parse layout JSON.");
        return;
    }
    const confirmed = await vscode.window.showWarningMessage(`Restore "${layout.name}"? Existing matching terminals will be re-spawned.`, { modal: true }, "Restore");
    if (confirmed !== "Restore") {
        return;
    }
    await applyLayout(deps, layout);
    void deps.audit.append((0, auditLog_1.makeEvent)("layout.restore", { name: layout.name }));
}
async function applyLayout(deps, layout) {
    for (const group of layout.groups) {
        const groupId = await deps.runtime.createGroup(group.name, group.icon);
        for (const terminalDef of group.terminals) {
            const resolvedCwd = resolveCwd(deps.workspaceFsPath, terminalDef.cwd);
            const terminal = vscode.window.createTerminal({
                name: terminalDef.name,
                cwd: resolvedCwd,
                iconPath: terminalDef.icon
                    ? new vscode.ThemeIcon(terminalDef.icon)
                    : undefined,
            });
            terminal.show(true);
            if (terminalDef.command && terminalDef.command.trim().length > 0) {
                terminal.sendText(terminalDef.command, true);
            }
            // Re-bind into the new group + lock the name shortly after adopt.
            const command = terminalDef.command;
            const requestedName = terminalDef.name;
            setTimeout(() => {
                const key = deps.runtime.resolveKey(terminal);
                if (!key) {
                    return;
                }
                const snap = deps.store.current();
                const record = snap.terminals.find((t) => t.key === key);
                if (!record) {
                    return;
                }
                void deps.store.apply((0, state_1.upsertTerminal)(snap, {
                    ...record,
                    groupId,
                    name: requestedName,
                    nameLocked: true,
                }));
                if (command) {
                    // No-op: command already sent.
                }
            }, 250);
        }
    }
}
function resolveCwd(workspaceFsPath, cwd) {
    if (!cwd) {
        return workspaceFsPath;
    }
    if (path.isAbsolute(cwd)) {
        return cwd;
    }
    if (!workspaceFsPath) {
        return undefined;
    }
    return path.join(workspaceFsPath, cwd);
}
async function openRecipeCommand(deps) {
    const recipesDir = path.join(deps.context.extensionPath, "media", "terminals", "recipes");
    let entries = [];
    try {
        entries = await fs.readdir(recipesDir);
    }
    catch {
        vscode.window.showErrorMessage("No recipes shipped with this build.");
        return;
    }
    const pick = await vscode.window.showQuickPick(entries
        .filter((file) => file.endsWith(".json"))
        .map((file) => ({
        label: file.slice(0, -".json".length),
        file: path.join(recipesDir, file),
    })), { placeHolder: "Pick a recipe" });
    if (!pick) {
        return;
    }
    const raw = await fs.readFile(pick.file, "utf8");
    const layout = (0, layouts_1.parseLayout)(JSON.parse(raw));
    if (!layout) {
        vscode.window.showErrorMessage("Recipe JSON is malformed.");
        return;
    }
    const choice = await vscode.window.showQuickPick(["Restore now", "Save copy to workspace"], {
        placeHolder: layout.name,
    });
    if (!choice) {
        return;
    }
    if (choice === "Save copy to workspace") {
        if (!deps.workspaceFsPath) {
            vscode.window.showWarningMessage("Open a workspace first.");
            return;
        }
        await (0, layouts_1.writeLayout)(deps.workspaceFsPath, layout);
        await deps.refreshLayouts();
        return;
    }
    await applyLayout(deps, layout);
}
async function sendBlockToChat(block, audit) {
    const body = `${block.command}\n${block.output}\nexit: ${block.exitCode ?? "?"}`;
    try {
        await vscode.commands.executeCommand("eri.chat.insertContext", {
            heading: `@Terminal block ${block.command}`,
            body,
        });
    }
    catch {
        await vscode.env.clipboard.writeText(body);
        vscode.window.showInformationMessage("Block copied — paste into chat (insert-context handler not registered).");
    }
    void audit.append((0, auditLog_1.makeEvent)("block.sentToChat", {
        blockId: block.id,
        terminal: block.terminalKey,
    }));
}
async function rerunBlock(block, deps) {
    const terminal = deps.runtime.resolveTerminal(block.terminalKey);
    if (!terminal) {
        vscode.window.showWarningMessage("Original terminal closed — cannot re-run.");
        return;
    }
    terminal.show();
    terminal.sendText(block.command, true);
}
function selectionForBlock(block, deps) {
    const snapshot = deps.store.current();
    const record = snapshot.terminals.find((t) => t.key === block.terminalKey);
    return {
        terminalKey: block.terminalKey,
        terminalName: record?.name ?? "(closed)",
    };
}
//# sourceMappingURL=commands.js.map