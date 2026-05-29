"use strict";
// Top-level wiring for the terminals module. Two concerns live behind a
// single activator:
//   1. Voice + gaze fusion (existing) — resolves "kill it" to whatever
//      terminal the user is gazing at.
//   2. Terminal organization (new) — tree view, groups, blocks, layouts.
//
// Both are local-only. Neither sends terminal output off-machine.
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateTerminalVoiceGaze = activateTerminalVoiceGaze;
exports.activateTerminalsOrganization = activateTerminalsOrganization;
const path = require("node:path");
const vscode = require("vscode");
const gaze_1 = require("./gaze");
const voice_1 = require("./voice");
const state_1 = require("./state");
const blocks_1 = require("./blocks");
const auditLog_1 = require("./auditLog");
const runtime_1 = require("./runtime");
const treeProvider_1 = require("./treeProvider");
const blocksView_1 = require("./blocksView");
const commands_1 = require("./commands");
const layouts_1 = require("./layouts");
function activateTerminalVoiceGaze(context, getSidecar, tryDispatchView, tryRouteWithLlm) {
    const gazeHandle = (0, gaze_1.activateTerminalGaze)(context);
    const organization = activateTerminalsOrganization(context);
    const voiceHandle = (0, voice_1.activateTerminalVoice)(context, {
        getSidecar,
        gaze: {
            attendedTerminalId: () => gazeHandle.attendedTerminalId(),
        },
        ...(tryDispatchView ? { tryDispatchView } : {}),
        ...(tryRouteWithLlm ? { tryRouteWithLlm } : {}),
    });
    const handle = {
        forward(notification) {
            gazeHandle.forward(notification);
            voiceHandle.forward(notification);
        },
        attendedTerminalId: () => gazeHandle.attendedTerminalId(),
        onAttention: gazeHandle.onAttention,
        organization,
        dispose() {
            voiceHandle.dispose();
            gazeHandle.dispose();
            organization.dispose();
        },
    };
    context.subscriptions.push({ dispose: () => handle.dispose() });
    return handle;
}
const ORG_VIEW_ID = "eri.terminals";
function activateTerminalsOrganization(context) {
    const workspaceFsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const audit = workspaceFsPath
        ? new auditLog_1.FileAuditSink(path.join(workspaceFsPath, ".eri", "audit.log"))
        : new auditLog_1.MemoryAuditSink();
    const store = new state_1.TerminalStateStore(context.workspaceState, workspaceFsPath);
    const blocks = new blocks_1.BlockStore(context.workspaceState);
    const runtime = new runtime_1.TerminalsRuntime(store, blocks, audit);
    const blocksView = new blocksView_1.TerminalBlocksView(blocks, async (block) => (0, commands_1.sendBlockToChat)(block, audit), async (block) => {
        const terminal = runtime.resolveTerminal(block.terminalKey);
        if (!terminal) {
            await vscode.window.showWarningMessage("Original terminal closed — cannot re-run.");
            return;
        }
        terminal.show();
        terminal.sendText(block.command, true);
    });
    const capture = new blocks_1.BlockCapture(blocks, (terminal) => runtime.resolveKey(terminal), audit);
    const tree = new treeProvider_1.TerminalsTreeProvider(store, runtime, blocks);
    const view = vscode.window.createTreeView(ORG_VIEW_ID, {
        treeDataProvider: tree,
        dragAndDropController: tree,
        showCollapseAll: true,
        canSelectMany: true,
    });
    view.onDidExpandElement((event) => {
        if (event.element.kind === "group") {
            void tree.setGroupExpanded(event.element.group.id, true);
        }
    });
    view.onDidCollapseElement((event) => {
        if (event.element.kind === "group") {
            void tree.setGroupExpanded(event.element.group.id, false);
        }
    });
    view.onDidChangeSelection((event) => {
        const node = event.selection[0];
        if (node && node.kind === "terminal") {
            blocksView.focus({
                terminalKey: node.record.key,
                terminalName: node.record.name,
            });
        }
    });
    const refreshLayouts = async () => {
        if (!workspaceFsPath) {
            tree.setLayouts([]);
            return;
        }
        try {
            const layouts = await (0, layouts_1.listLayouts)(workspaceFsPath);
            tree.setLayouts(layouts);
        }
        catch {
            tree.setLayouts([]);
        }
    };
    void refreshLayouts();
    const commandSub = (0, commands_1.registerTerminalCommands)({
        context,
        runtime,
        store,
        blocks,
        blocksView,
        tree,
        audit,
        workspaceFsPath,
        refreshLayouts,
    });
    const blocksViewSub = vscode.window.registerWebviewViewProvider(blocksView_1.TerminalBlocksView.viewId, blocksView);
    context.subscriptions.push(vscode.commands.registerCommand("eri.terminals.rerunBlock", async (blockId) => {
        const block = blocks.flatten().find((b) => b.id === blockId);
        if (!block) {
            return;
        }
        await (0, commands_1.rerunBlock)(block, {
            context,
            runtime,
            store,
            blocks,
            blocksView,
            tree,
            audit,
            workspaceFsPath,
            refreshLayouts,
        });
    }));
    const handle = {
        view,
        refreshLayouts,
        dispose: () => {
            view.dispose();
            capture.dispose();
            runtime.dispose();
            blocks.dispose();
            store.dispose();
            audit.dispose();
        },
    };
    context.subscriptions.push(view, commandSub, blocksViewSub);
    return handle;
}
//# sourceMappingURL=index.js.map