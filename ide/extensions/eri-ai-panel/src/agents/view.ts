// Tree view for the `eri.agents` sidebar — lists agents grouped by
// "eri" (default), "Bring your own keys", and "External CLIs", mirroring
// the QuickPick picker so the user sees the same surface everywhere.
//
// Internal proxy variants (surface === "hidden") are NEVER shown here —
// the brain layer dispatches to them under the hood when the active
// agent is the default eri router.

import * as vscode from "vscode";
import { AgentRegistry } from "./registry";
import { AgentDescriptor, AgentSurface } from "./types";

type Node = GroupNode | AgentNode;

type Group = Extract<AgentSurface, "default" | "byok" | "cli">;

interface GroupNode {
  readonly kind: "group";
  readonly id: Group;
  readonly label: string;
}

interface AgentNode {
  readonly kind: "agent";
  readonly descriptor: AgentDescriptor;
  readonly isActive: boolean;
}

const GROUP_LABEL: Record<Group, string> = {
  default: "eri",
  byok: "Bring your own keys",
  cli: "External CLIs",
};

const GROUP_ORDER: readonly Group[] = ["default", "byok", "cli"];

function groupOf(d: AgentDescriptor): Group | "hidden" {
  if (d.surface === "hidden") return "hidden";
  if (d.surface === "byok") return "byok";
  if (d.surface === "cli") return "cli";
  return "default";
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
      const item = new vscode.TreeItem(
        node.label,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.contextValue = `eri.agents.group.${node.id}`;
      return item;
    }
    const d = node.descriptor;
    const item = new vscode.TreeItem(d.label, vscode.TreeItemCollapsibleState.None);
    item.description = describe(d) + (node.isActive ? " · active" : "");
    item.tooltip = d.description;
    item.contextValue = d.available
      ? "eri.agents.agent.available"
      : "eri.agents.agent.unavailable";
    item.iconPath = new vscode.ThemeIcon(iconFor(d));
    item.command = d.available
      ? { command: "eri.agents.setActive", title: "Set active", arguments: [d.id] }
      : undefined;
    return item;
  }

  getChildren(parent?: Node): Node[] {
    if (!parent) {
      // Only render groups that actually have visible agents — keeps the
      // tree tight when (e.g.) the user hasn't set any BYOK keys yet.
      const counts = countPerGroup(this.registry.list());
      return GROUP_ORDER.filter((g) => counts[g] > 0).map<GroupNode>((g) => ({
        kind: "group",
        id: g,
        label: GROUP_LABEL[g],
      }));
    }
    if (parent.kind !== "group") {
      return [];
    }
    const active = this.registry.active();
    return this.registry
      .list()
      .filter((d) => groupOf(d) === parent.id)
      .sort(sortByAvailabilityThenLabel)
      .map<AgentNode>((d) => ({
        kind: "agent",
        descriptor: d,
        isActive: d.id === active.id,
      }));
  }
}

function countPerGroup(
  agents: ReadonlyArray<AgentDescriptor>,
): Record<Group, number> {
  const counts: Record<Group, number> = { default: 0, byok: 0, cli: 0 };
  for (const d of agents) {
    const g = groupOf(d);
    if (g === "hidden") continue;
    counts[g] += 1;
  }
  return counts;
}

function sortByAvailabilityThenLabel(
  a: AgentDescriptor,
  b: AgentDescriptor,
): number {
  if (a.available !== b.available) return a.available ? -1 : 1;
  return a.label.localeCompare(b.label);
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
    case "auto":
      return "auto-routed";
    case "mercury":
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
