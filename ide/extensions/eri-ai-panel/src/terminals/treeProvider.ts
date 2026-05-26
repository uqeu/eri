// Tree data provider + drag-and-drop controller for the eri.terminals view.
// Mirrors the live VS Code terminal list — never owns or persists terminal
// instances themselves.

import * as vscode from "vscode";
import {
  GroupRecord,
  StateSnapshot,
  TerminalRecord,
  TerminalStateStore,
  moveTerminal,
  updateGroup,
} from "./state";
import { BlockStore, TerminalBlock } from "./blocks";
import { SavedLayoutRef } from "./layouts";
import { CliKind, cliGlyph, cliLabel } from "./cliDetect";

// View item kinds ---------------------------------------------------------

export type TerminalsNode =
  | GroupNode
  | TerminalNode
  | LayoutsRootNode
  | LayoutNode
  | PlaceholderNode;

export class GroupNode extends vscode.TreeItem {
  readonly kind = "group" as const;

  constructor(public readonly group: GroupRecord, terminalCount: number) {
    super(
      group.name,
      group.expanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.id = `group:${group.id}`;
    this.contextValue = group.auto ? "eri.terminal.group.auto" : "eri.terminal.group";
    this.description = `${terminalCount}`;
    this.iconPath = new vscode.ThemeIcon(group.icon ?? "folder");
    this.tooltip = group.cwd ? `${group.name} — ${group.cwd}` : group.name;
  }
}

export class TerminalNode extends vscode.TreeItem {
  readonly kind = "terminal" as const;

  constructor(
    public readonly record: TerminalRecord,
    public readonly terminal: vscode.Terminal | undefined,
    status: TerminalStatus,
    lastCommand: string | null,
    cliKind: CliKind | null = null,
  ) {
    super(record.name, vscode.TreeItemCollapsibleState.None);
    this.id = `terminal:${record.key}`;
    this.contextValue = record.nameLocked
      ? "eri.terminal.locked"
      : "eri.terminal";
    this.iconPath = cliKind
      ? new vscode.ThemeIcon(cliGlyph(cliKind), new vscode.ThemeColor("charts.purple"))
      : iconForStatus(status, record.icon);
    this.description = describe(status, lastCommand, cliKind);
    this.tooltip = buildTooltip(record, status, lastCommand, cliKind);
    if (terminal) {
      this.command = {
        command: "eri.terminals.reveal",
        title: "Show terminal",
        arguments: [record.key],
      };
    }
  }
}

export class LayoutsRootNode extends vscode.TreeItem {
  readonly kind = "layoutsRoot" as const;

  constructor(count: number) {
    super("Layouts", vscode.TreeItemCollapsibleState.Collapsed);
    this.id = "layouts-root";
    this.contextValue = "eri.terminal.layouts.root";
    this.description = `${count}`;
    this.iconPath = new vscode.ThemeIcon("layers");
  }
}

export class LayoutNode extends vscode.TreeItem {
  readonly kind = "layout" as const;

  constructor(public readonly layout: SavedLayoutRef) {
    super(layout.name, vscode.TreeItemCollapsibleState.None);
    this.id = `layout:${layout.filePath}`;
    this.contextValue = "eri.terminal.layout";
    this.iconPath = new vscode.ThemeIcon("save");
    this.tooltip = layout.filePath;
    this.command = {
      command: "eri.terminals.restoreLayout",
      title: "Restore layout",
      arguments: [layout.filePath],
    };
  }
}

export class PlaceholderNode extends vscode.TreeItem {
  readonly kind = "placeholder" as const;

  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "eri.terminal.placeholder";
    this.iconPath = new vscode.ThemeIcon("info");
  }
}

// Status -----------------------------------------------------------------

export type TerminalStatus = "running" | "idle" | "exited-ok" | "exited-fail";

export interface TerminalRuntime {
  status(key: string): TerminalStatus;
  lastCommand(key: string): string | null;
  resolveTerminal(key: string): vscode.Terminal | undefined;
  cliKind?(key: string): CliKind | null;
}

function iconForStatus(
  status: TerminalStatus,
  customIcon: string | undefined,
): vscode.ThemeIcon {
  if (customIcon) {
    return new vscode.ThemeIcon(customIcon);
  }
  switch (status) {
    case "running":
      return new vscode.ThemeIcon(
        "loading~spin",
        new vscode.ThemeColor("charts.green"),
      );
    case "idle":
      return new vscode.ThemeIcon("terminal");
    case "exited-ok":
      return new vscode.ThemeIcon(
        "check",
        new vscode.ThemeColor("charts.green"),
      );
    case "exited-fail":
      return new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
  }
}

function describe(
  status: TerminalStatus,
  lastCommand: string | null,
  cliKind: CliKind | null,
): string {
  const badge = (() => {
    switch (status) {
      case "running":
        return "● running";
      case "idle":
        return "○ idle";
      case "exited-ok":
        return "✓ exit 0";
      case "exited-fail":
        return "✗ failed";
    }
  })();
  const cliBadge = cliKind ? `🤖 ${cliLabel(cliKind)} · ` : "";
  if (lastCommand && lastCommand.length > 0) {
    return `${cliBadge}${badge} · ${lastCommand}`;
  }
  return `${cliBadge}${badge}`;
}

function buildTooltip(
  record: TerminalRecord,
  status: TerminalStatus,
  lastCommand: string | null,
  cliKind: CliKind | null,
): string {
  const parts = [
    `Name: ${record.name}${record.nameLocked ? " (locked)" : ""}`,
    `Status: ${status}`,
  ];
  if (cliKind) {
    parts.push(`Running: ${cliLabel(cliKind)}`);
  }
  if (record.cwd) {
    parts.push(`Cwd: ${record.cwd}`);
  }
  if (lastCommand) {
    parts.push(`Last: ${lastCommand}`);
  }
  return parts.join("\n");
}

// Provider ----------------------------------------------------------------

const MIME_TERMINAL = "application/vnd.eri.terminal";

export class TerminalsTreeProvider
  implements
    vscode.TreeDataProvider<TerminalsNode>,
    vscode.TreeDragAndDropController<TerminalsNode>
{
  readonly dropMimeTypes = [MIME_TERMINAL];
  readonly dragMimeTypes = [MIME_TERMINAL];

  private readonly emitter = new vscode.EventEmitter<
    TerminalsNode | undefined
  >();
  readonly onDidChangeTreeData = this.emitter.event;

  private layouts: ReadonlyArray<SavedLayoutRef> = [];

  constructor(
    private readonly store: TerminalStateStore,
    private readonly runtime: TerminalRuntime,
    private readonly blocks: BlockStore,
  ) {
    this.store.onDidChange(() => this.refresh());
    this.blocks.onDidChange(() => this.refresh());
  }

  setLayouts(layouts: ReadonlyArray<SavedLayoutRef>): void {
    this.layouts = layouts;
    this.refresh();
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: TerminalsNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TerminalsNode): Promise<TerminalsNode[]> {
    const snapshot = this.store.current();
    if (!element) {
      return this.rootNodes(snapshot);
    }
    if (element.kind === "group") {
      return this.terminalsInGroup(snapshot, element.group.id);
    }
    if (element.kind === "layoutsRoot") {
      return this.layouts.map((layout) => new LayoutNode(layout));
    }
    return [];
  }

  private rootNodes(snapshot: StateSnapshot): TerminalsNode[] {
    if (snapshot.groups.length === 0 && this.layouts.length === 0) {
      return [
        new PlaceholderNode(
          "(no terminals yet — open one to start auto-grouping)",
        ),
      ];
    }
    const nodes: TerminalsNode[] = [];
    for (const group of snapshot.groups) {
      const members = snapshot.terminals.filter(
        (t) => t.groupId === group.id,
      );
      nodes.push(new GroupNode(group, members.length));
    }
    nodes.push(new LayoutsRootNode(this.layouts.length));
    return nodes;
  }

  private terminalsInGroup(
    snapshot: StateSnapshot,
    groupId: string,
  ): TerminalsNode[] {
    const members = snapshot.terminals.filter((t) => t.groupId === groupId);
    if (members.length === 0) {
      return [new PlaceholderNode("(empty group)")];
    }
    return members.map((record) => {
      const status = this.runtime.status(record.key);
      const lastCommand = this.runtime.lastCommand(record.key);
      const cliKind = this.runtime.cliKind?.(record.key) ?? null;
      const terminal = this.runtime.resolveTerminal(record.key);
      return new TerminalNode(record, terminal, status, lastCommand, cliKind);
    });
  }

  // Drag-and-drop --------------------------------------------------------

  handleDrag(
    source: readonly TerminalsNode[],
    dataTransfer: vscode.DataTransfer,
  ): void {
    const keys = source
      .filter((node): node is TerminalNode => node.kind === "terminal")
      .map((node) => node.record.key);
    if (keys.length === 0) {
      return;
    }
    dataTransfer.set(
      MIME_TERMINAL,
      new vscode.DataTransferItem(JSON.stringify(keys)),
    );
  }

  async handleDrop(
    target: TerminalsNode | undefined,
    dataTransfer: vscode.DataTransfer,
  ): Promise<void> {
    const item = dataTransfer.get(MIME_TERMINAL);
    if (!item) {
      return;
    }
    const raw = await item.asString();
    let keys: string[];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }
      keys = parsed.filter((k): k is string => typeof k === "string");
    } catch {
      return;
    }
    if (keys.length === 0) {
      return;
    }
    const snapshot = this.store.current();
    const groupId = this.resolveDropTargetGroup(snapshot, target);
    if (!groupId) {
      return;
    }
    let next = snapshot;
    for (const key of keys) {
      next = moveTerminal(next, key, groupId);
    }
    await this.store.apply(next);
  }

  private resolveDropTargetGroup(
    snapshot: StateSnapshot,
    target: TerminalsNode | undefined,
  ): string | undefined {
    if (!target) {
      return snapshot.groups[0]?.id;
    }
    if (target.kind === "group") {
      return target.group.id;
    }
    if (target.kind === "terminal") {
      return target.record.groupId;
    }
    return undefined;
  }

  // Persistence shim used by collapse/expand events.
  async setGroupExpanded(
    groupId: string,
    expanded: boolean,
  ): Promise<void> {
    const snapshot = this.store.current();
    const group = snapshot.groups.find((g) => g.id === groupId);
    if (!group || group.expanded === expanded) {
      return;
    }
    await this.store.apply(updateGroup(snapshot, groupId, { expanded }));
  }
}

// Re-export block typedef for the block side panel consumer.
export type { TerminalBlock };
