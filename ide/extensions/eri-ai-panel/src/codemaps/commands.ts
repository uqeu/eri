import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { CodemapsTreeDataProvider, currentWorkspaceFsPath } from "./view";
import { openCodemapWebview } from "./webview";

interface GenerateResponse {
  readonly name: string;
  readonly nodes: number;
  readonly edges: number;
  readonly generatedAtMs: number;
}

type KindId = "module" | "hotspot" | "function" | "data";

interface KindChoice {
  readonly label: string;
  readonly description: string;
  readonly id: KindId;
}

const KIND_CHOICES: ReadonlyArray<KindChoice> = [
  {
    id: "module",
    label: "$(symbol-namespace) Module",
    description: "Top-level directories and how they depend on each other",
  },
  {
    id: "hotspot",
    label: "$(flame) Hotspot",
    description: "Files ranked by chunk density and indexed bytes",
  },
  {
    id: "function",
    label: "$(symbol-method) Function (not yet implemented)",
    description: "Call graph rooted at a chosen function — coming soon",
  },
  {
    id: "data",
    label: "$(symbol-structure) Data (not yet implemented)",
    description: "Types and the files that define / use them — coming soon",
  },
];

export function registerCodemapCommands(
  context: vscode.ExtensionContext,
  provider: CodemapsTreeDataProvider,
  getSidecar: () => Sidecar | null,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("eri.codemaps.refresh", () =>
      provider.refresh(),
    ),
    vscode.commands.registerCommand("eri.codemaps.generate", () =>
      runGenerate(provider, getSidecar),
    ),
    vscode.commands.registerCommand(
      "eri.codemaps.open",
      (nameOrItem: unknown) => runOpen(provider, getSidecar, nameOrItem),
    ),
  );
}

async function runGenerate(
  provider: CodemapsTreeDataProvider,
  getSidecar: () => Sidecar | null,
): Promise<void> {
  const sidecar = getSidecar();
  const workspace = currentWorkspaceFsPath();
  if (!sidecar || !workspace) {
    vscode.window.showWarningMessage(
      "eri Codemaps — open a workspace and wait for the sidecar to start.",
    );
    return;
  }
  const picked = await vscode.window.showQuickPick(
    KIND_CHOICES.map((entry) => ({
      label: entry.label,
      description: entry.description,
      id: entry.id,
    })),
    {
      placeHolder: "Generate codemap — pick a kind",
      matchOnDescription: true,
    },
  );
  if (!picked) {
    return;
  }
  const params: Record<string, unknown> = {
    workspace,
    kind: picked.id,
  };
  if (picked.id === "function") {
    const root = await vscode.window.showInputBox({
      prompt: "Root function name",
      placeHolder: "main",
    });
    if (!root) {
      return;
    }
    params.root = root;
    params.depth = 2;
  }
  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `eri · generating ${picked.id} codemap…`,
      },
      () =>
        sidecar.request<GenerateResponse>("eri/codemaps/generate", params),
    );
    await provider.refresh();
    vscode.window.showInformationMessage(
      `eri Codemap "${result.name}" — ${result.nodes} nodes, ${result.edges} edges`,
    );
    await openCodemapWebview(result.name, getSidecar);
  } catch (err) {
    vscode.window.showErrorMessage(
      `eri Codemaps — generate failed: ${errorMessage(err)}`,
    );
  }
}

async function runOpen(
  provider: CodemapsTreeDataProvider,
  getSidecar: () => Sidecar | null,
  nameOrItem: unknown,
): Promise<void> {
  const name = await resolveName(provider, nameOrItem);
  if (!name) {
    return;
  }
  await openCodemapWebview(name, getSidecar);
}

async function resolveName(
  provider: CodemapsTreeDataProvider,
  nameOrItem: unknown,
): Promise<string | undefined> {
  if (typeof nameOrItem === "string" && nameOrItem.trim().length > 0) {
    return nameOrItem;
  }
  if (
    nameOrItem &&
    typeof nameOrItem === "object" &&
    "summary" in nameOrItem &&
    (nameOrItem as { summary: { name?: unknown } }).summary?.name
  ) {
    const candidate = (nameOrItem as { summary: { name: unknown } }).summary
      .name;
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  const available = provider.current();
  if (available.length === 0) {
    vscode.window.showInformationMessage(
      "eri Codemaps — none saved yet. Run 'eri: Generate Codemap'.",
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    available.map((summary) => ({
      label: summary.name,
      description: summary.kind,
    })),
    { placeHolder: "Open codemap" },
  );
  return picked?.label;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
