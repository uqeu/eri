// QuickPick UI for switching the active agent. Shows available agents
// at the top; unavailable agents are listed below with a hint about why
// they can't be selected (sign in / install CLI / set BYOK key).

import * as vscode from "vscode";
import { AgentRegistry } from "./registry";
import { AgentDescriptor } from "./types";

interface PickItem extends vscode.QuickPickItem {
  readonly id: string;
  readonly available: boolean;
}

export async function showAgentPicker(registry: AgentRegistry): Promise<void> {
  await registry.refreshAvailability();
  const descriptors = [...registry.list()];
  descriptors.sort(sortByAvailabilityThenLabel);
  const active = registry.active();
  const items: PickItem[] = descriptors.map((d) => ({
    id: d.id,
    label: `${availabilityDot(d)} ${d.label}`,
    description: d.id === active.id ? "active" : describeBadge(d),
    detail: d.available ? d.description : `${d.description} — ${unavailableHint(d)}`,
    available: d.available,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    title: "eri: switch agent",
    placeHolder: `current: ${active.label}`,
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!pick) return;
  if (!pick.available) {
    vscode.window.showInformationMessage(
      `${pick.label} is unavailable. ${describeBadge({ id: pick.id } as AgentDescriptor)}`,
    );
    return;
  }
  await registry.setActive(pick.id);
}

function sortByAvailabilityThenLabel(a: AgentDescriptor, b: AgentDescriptor): number {
  if (a.available !== b.available) return a.available ? -1 : 1;
  return a.label.localeCompare(b.label);
}

function availabilityDot(d: AgentDescriptor): string {
  if (!d.available) return "○";
  if (d.kind === "cli") return "🟢";
  if (d.free) return "🟡";
  return "🔵";
}

function describeBadge(d: AgentDescriptor): string {
  switch (d.kind) {
    case "mercury":
    case "auto":
      return "free · eri Engine";
    case "proxy":
      return "metered · eri proxy";
    case "byok":
      return "your key · no eri cost";
    case "cli":
      return "local CLI · no eri cost";
    default:
      return "";
  }
}

function unavailableHint(d: AgentDescriptor): string {
  switch (d.kind) {
    case "proxy":
      return "sign in to eri";
    case "byok":
      return "add an API key in Settings";
    case "cli":
      return `install \`${d.binary ?? "binary"}\` on your PATH`;
    default:
      return "unavailable";
  }
}
