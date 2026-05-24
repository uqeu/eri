import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import {
  SkillNode,
  SkillsTreeDataProvider,
  SkillSummary,
} from "./skillsView";

export interface SkillsHandle {
  readonly view: vscode.TreeView<SkillNode>;
  refresh(): Promise<void>;
  dispose(): void;
}

interface ListResult {
  skills?: ReadonlyArray<{
    name?: unknown;
    description?: unknown;
    when?: unknown;
  }>;
}

export function activateSkills(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
): SkillsHandle {
  const provider = new SkillsTreeDataProvider();
  const view = vscode.window.createTreeView<SkillNode>("eri.skills", {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  const refresh = async (): Promise<void> => {
    const sidecar = getSidecar();
    if (!sidecar) {
      provider.setError("Sidecar not running.");
      return;
    }
    const workspace = resolveWorkspace();
    if (!workspace) {
      provider.setError("Open a workspace folder to load skills.");
      return;
    }
    try {
      const result = await sidecar.request<ListResult>("eri/skills/list", {
        workspace,
      });
      const parsed = parseSkills(result?.skills);
      provider.setSkills(parsed);
    } catch (err: unknown) {
      provider.setError(`Failed to load skills: ${getErrorMessage(err)}`);
    }
  };

  // Initial fetch — fire and forget; errors surface as a placeholder row.
  void refresh();

  context.subscriptions.push(
    view,
    vscode.commands.registerCommand("eri.skills.refresh", refresh),
  );

  return {
    view,
    refresh,
    dispose: () => {
      view.dispose();
    },
  };
}

function resolveWorkspace(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return null;
  }
  return folders[0].uri.fsPath;
}

function parseSkills(raw: unknown): ReadonlyArray<SkillSummary> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: SkillSummary[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const obj = entry as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name : null;
    if (!name) {
      continue;
    }
    const description =
      typeof obj.description === "string" ? obj.description : "";
    const when = Array.isArray(obj.when)
      ? obj.when.filter((w): w is string => typeof w === "string")
      : [];
    out.push({ name, description, when });
  }
  return out;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return "unknown error";
}
