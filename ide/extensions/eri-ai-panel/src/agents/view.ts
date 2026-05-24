// Tree view for the `eri.agents` sidebar — lists agents grouped by
// Available / Unavailable, with context-menu actions.

import * as vscode from "vscode";
import { AgentRegistry } from "./registry";
import { AgentDescriptor } from "./types";

type Node = GroupNode | AgentNode;

interface GroupNode {
  readonly kind: "group";
  readonly id: "available" | "unavailable";
  readonly label: string;
}

interface AgentNode {
  readonly kind: "agent";
  readonly descriptor: AgentDescriptor;
  readonly isActive: boolean;
}

export class AgentsTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly registry: AgentRegistry) {
    registry.onChange(() => this.emitter.fire());
  }

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "group") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = `eri.agents.group.${node.id}`;
      return item;
    }
    const d = node.descriptor;
    const item = new vscode.TreeItem(d.label, vscode.TreeItemCollapsibleState.None);
    item.description = describe(d) + (node.isActive ? " · active" : "");
    item.tooltip = d.description;
    item.contextValue = d.available ? "eri.agents.agent.available" : "eri.agents.agent.unavailable";
    item.iconPath = new vscode.ThemeIcon(iconFor(d));
    item.command = d.available
      ? { command: "eri.agents.setActive", title: "Set active", arguments: [d.id] }
      : undefined;
    return item;
  }

  getChildren(parent?: Node): Node[] {
    if (!parent) {
      return [
        { kind: "group", id: "available", label: "Available" },
        { kind: "group", id: "unavailable", label: "Unavailable" },
      ];
    }
    if (parent.kind !== "group") {
      return [];
    }
    const active = this.registry.active();
    return this.registry
      .list()
      .filter((d) => (parent.id === "available" ? d.available : !d.available))
      .sort((a, b) => a.label.localeCompare(b.label))
      .map<AgentNode>((d) => ({
        kind: "agent",
        descriptor: d,
        isActive: d.id === active.id,
      }));
  }
}

function iconFor(d: AgentDescriptor): string {
  if (d.kind === "cli") return "terminal";
  if (d.kind === "byok") return "key";
  if (d.kind === "auto") return "rocket";
  return "zap";
}

function describe(d: AgentDescriptor): string {
  if (!d.available) return "unavailable";
  switch (d.kind) {
    case "mercury":
    case "auto":
      return "free";
    case "proxy":
      return "metered";
    case "byok":
      return "your key";
    case "cli":
      return "local";
    default:
      return "";
  }
}
