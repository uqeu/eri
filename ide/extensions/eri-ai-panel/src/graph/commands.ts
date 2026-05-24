import * as vscode from "vscode";
import { GraphClient, GraphNode } from "./api";
import { GraphTreeDataProvider, NodeItem } from "./view";
import { openGraphVisualization } from "./webview";

// Wire up the commands the package.json declares. Keeping this in one file
// makes it easy to audit which commands talk to the graph.
export function registerGraphCommands(
  context: vscode.ExtensionContext,
  provider: GraphTreeDataProvider,
  client: GraphClient,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("eri.graph.refresh", async () => {
      await provider.refresh();
    }),
    vscode.commands.registerCommand("eri.graph.visualize", async () => {
      try {
        await openGraphVisualization(client);
      } catch (err) {
        vscode.window.showErrorMessage(
          `eri Graph — failed to open visualization: ${errorMessage(err)}`,
        );
      }
    }),
    vscode.commands.registerCommand("eri.graph.search", async () => {
      const q = await vscode.window.showInputBox({
        prompt: "Search eri graph",
        placeHolder: "e.g. login bug, refactor auth, build error",
      });
      if (!q) {
        return;
      }
      try {
        const hits = await client.search(q, 25);
        await pickAndOpen(client, hits, `${hits.length} hit(s) for "${q}"`);
      } catch (err) {
        vscode.window.showErrorMessage(
          `eri Graph — search failed: ${errorMessage(err)}`,
        );
      }
    }),
    vscode.commands.registerCommand("eri.graph.openNode", async (id: string) => {
      if (!id) {
        return;
      }
      try {
        const node = await client.get(id);
        if (!node) {
          vscode.window.showWarningMessage(`eri Graph — node ${id} not found`);
          return;
        }
        await openNodeAsJson(node);
      } catch (err) {
        vscode.window.showErrorMessage(
          `eri Graph — failed to open node: ${errorMessage(err)}`,
        );
      }
    }),
    vscode.commands.registerCommand(
      "eri.graph.openNodeJson",
      async (item: NodeItem | undefined) => {
        if (!item || !item.node) {
          return;
        }
        await openNodeAsJson(item.node);
      },
    ),
    vscode.commands.registerCommand("eri.graph.addNote", async () => {
      const text = await vscode.window.showInputBox({
        prompt: "New note (will be recorded in the eri graph)",
        placeHolder: "remember this…",
      });
      if (!text) {
        return;
      }
      const tagsRaw = await vscode.window.showInputBox({
        prompt: "Tags (comma-separated, optional)",
        placeHolder: "design, login",
      });
      const tags = tagsRaw
        ? tagsRaw
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t.length > 0)
        : [];
      try {
        await client.insertNode("note", { text }, tags);
        await provider.refresh();
        vscode.window.showInformationMessage("eri Graph — note recorded");
      } catch (err) {
        vscode.window.showErrorMessage(
          `eri Graph — failed to add note: ${errorMessage(err)}`,
        );
      }
    }),
    vscode.commands.registerCommand(
      "eri.graph.tagNode",
      async (item: NodeItem | undefined) => {
        const node = item?.node ?? (await pickNodeFromRecent(client));
        if (!node) {
          return;
        }
        const input = await vscode.window.showInputBox({
          prompt: `Add tags to ${node.kind} (comma-separated)`,
          value: node.tags.join(", "),
        });
        if (input === undefined) {
          return;
        }
        const tags = input
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        try {
          // We don't expose a node-update RPC yet; record the new tags as a
          // note linked to the original via `related_to`. This keeps the
          // wire surface small while still preserving user intent.
          const id = await client.insertNode(
            "note",
            { text: `tagged: ${tags.join(", ")}`, ref: node.id },
            tags,
          );
          await client.insertEdge(id, node.id, "related_to");
          await provider.refresh();
        } catch (err) {
          vscode.window.showErrorMessage(
            `eri Graph — failed to tag: ${errorMessage(err)}`,
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      "eri.graph.linkRelated",
      async (item: NodeItem | undefined) => {
        if (!item || !item.node) {
          return;
        }
        const target = await pickNodeFromRecent(
          client,
          "Pick the related node",
          item.node.id,
        );
        if (!target) {
          return;
        }
        try {
          await client.insertEdge(item.node.id, target.id, "related_to");
          await provider.refresh();
          vscode.window.showInformationMessage(
            `eri Graph — linked ${item.node.kind} → ${target.kind}`,
          );
        } catch (err) {
          vscode.window.showErrorMessage(
            `eri Graph — failed to link: ${errorMessage(err)}`,
          );
        }
      },
    ),
    vscode.commands.registerCommand("eri.graph.export", async () => {
      try {
        const path = await client.export();
        vscode.window.showInformationMessage(
          `eri Graph — exported to ${path}`,
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `eri Graph — export failed: ${errorMessage(err)}`,
        );
      }
    }),
    vscode.commands.registerCommand("eri.graph.showStats", async () => {
      try {
        const stats = await client.stats();
        vscode.window.showInformationMessage(
          `eri Graph — ${stats.nodes} nodes · ${stats.edges} edges · ${stats.sessions} session(s)`,
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `eri Graph — stats failed: ${errorMessage(err)}`,
        );
      }
    }),
  );
}

async function openNodeAsJson(node: GraphNode): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    language: "json",
    content: JSON.stringify(node, null, 2),
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

async function pickAndOpen(
  _client: GraphClient,
  nodes: ReadonlyArray<GraphNode>,
  title: string,
): Promise<void> {
  if (nodes.length === 0) {
    vscode.window.showInformationMessage(`eri Graph — ${title}`);
    return;
  }
  const picked = await vscode.window.showQuickPick(
    nodes.map((node) => ({
      label: `[${node.kind}] ${describe(node)}`,
      description: new Date(node.created_at_ms).toLocaleString(),
      detail: node.id,
      node,
    })),
    { title, placeHolder: "Select a node to open" },
  );
  if (!picked) {
    return;
  }
  await openNodeAsJson(picked.node);
}

async function pickNodeFromRecent(
  client: GraphClient,
  title = "Pick a node",
  excludeId?: string,
): Promise<GraphNode | undefined> {
  try {
    const recent = await client.queryByKind("prompt", 50);
    const picked = await vscode.window.showQuickPick(
      recent
        .filter((n) => n.id !== excludeId)
        .map((node) => ({
          label: `[${node.kind}] ${describe(node)}`,
          description: new Date(node.created_at_ms).toLocaleString(),
          detail: node.id,
          node,
        })),
      { title },
    );
    return picked?.node;
  } catch (err) {
    vscode.window.showErrorMessage(
      `eri Graph — failed to fetch nodes: ${errorMessage(err)}`,
    );
    return undefined;
  }
}

function describe(node: GraphNode): string {
  const body = node.body;
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    for (const key of ["text", "label", "summary", "name", "path", "sha"]) {
      const value = obj[key];
      if (typeof value === "string" && value.length > 0) {
        return value.length > 60 ? value.slice(0, 59) + "…" : value;
      }
    }
  }
  return node.id;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
