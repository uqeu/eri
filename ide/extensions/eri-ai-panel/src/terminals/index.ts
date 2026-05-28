// Top-level wiring for the terminals module. Two concerns live behind a
// single activator:
//   1. Voice + gaze fusion (existing) — resolves "kill it" to whatever
//      terminal the user is gazing at.
//   2. Terminal organization (new) — tree view, groups, blocks, layouts.
//
// Both are local-only. Neither sends terminal output off-machine.

import * as path from "node:path";
import * as vscode from "vscode";
import { Sidecar, SidecarNotification } from "../sidecar";
import { TerminalGazeHandle, activateTerminalGaze } from "./gaze";
import { VoiceHandle, activateTerminalVoice } from "./voice";
import { TerminalStateStore } from "./state";
import { BlockCapture, BlockStore } from "./blocks";
import {
  AuditSink,
  FileAuditSink,
  MemoryAuditSink,
} from "./auditLog";
import { TerminalsRuntime } from "./runtime";
import { TerminalsTreeProvider, TerminalsNode } from "./treeProvider";
import { TerminalBlocksView } from "./blocksView";
import {
  registerTerminalCommands,
  rerunBlock,
  sendBlockToChat,
} from "./commands";
import { listLayouts } from "./layouts";

export interface TerminalVoiceGazeHandle {
  readonly forward: (notification: SidecarNotification) => void;
  readonly dispose: () => void;
  // Exposed for sibling modules that want to tag a UI affordance.
  readonly attendedTerminalId: () => string | undefined;
  readonly onAttention: TerminalGazeHandle["onAttention"];
  readonly organization: TerminalsOrganizationHandle;
}

export interface TerminalsOrganizationHandle {
  readonly view: vscode.TreeView<TerminalsNode>;
  refreshLayouts(): Promise<void>;
  dispose(): void;
}

export function activateTerminalVoiceGaze(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
  tryDispatchView?: (transcript: string) => Promise<boolean>,
): TerminalVoiceGazeHandle {
  const gazeHandle = activateTerminalGaze(context);

  const organization = activateTerminalsOrganization(context);

  const voiceHandle: VoiceHandle = activateTerminalVoice(context, {
    getSidecar,
    gaze: {
      attendedTerminalId: () => gazeHandle.attendedTerminalId(),
    },
    ...(tryDispatchView ? { tryDispatchView } : {}),
  });

  const handle: TerminalVoiceGazeHandle = {
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

export function activateTerminalsOrganization(
  context: vscode.ExtensionContext,
): TerminalsOrganizationHandle {
  const workspaceFsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const audit: AuditSink = workspaceFsPath
    ? new FileAuditSink(path.join(workspaceFsPath, ".eri", "audit.log"))
    : new MemoryAuditSink();

  const store = new TerminalStateStore(
    context.workspaceState,
    workspaceFsPath,
  );
  const blocks = new BlockStore(context.workspaceState);
  const runtime = new TerminalsRuntime(store, blocks, audit);

  const blocksView = new TerminalBlocksView(
    blocks,
    async (block) => sendBlockToChat(block, audit),
    async (block) => {
      const terminal = runtime.resolveTerminal(block.terminalKey);
      if (!terminal) {
        await vscode.window.showWarningMessage(
          "Original terminal closed — cannot re-run.",
        );
        return;
      }
      terminal.show();
      terminal.sendText(block.command, true);
    },
  );

  const capture = new BlockCapture(
    blocks,
    (terminal) => runtime.resolveKey(terminal),
    audit,
  );

  const tree = new TerminalsTreeProvider(store, runtime, blocks);
  const view = vscode.window.createTreeView<TerminalsNode>(ORG_VIEW_ID, {
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

  const refreshLayouts = async (): Promise<void> => {
    if (!workspaceFsPath) {
      tree.setLayouts([]);
      return;
    }
    try {
      const layouts = await listLayouts(workspaceFsPath);
      tree.setLayouts(layouts);
    } catch {
      tree.setLayouts([]);
    }
  };
  void refreshLayouts();

  const commandSub = registerTerminalCommands({
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

  const blocksViewSub = vscode.window.registerWebviewViewProvider(
    TerminalBlocksView.viewId,
    blocksView,
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "eri.terminals.rerunBlock",
      async (blockId: string) => {
        const block = blocks.flatten().find((b) => b.id === blockId);
        if (!block) {
          return;
        }
        await rerunBlock(block, {
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
      },
    ),
  );

  const handle: TerminalsOrganizationHandle = {
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
