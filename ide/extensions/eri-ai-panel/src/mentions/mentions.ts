import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { EriMentionCompletionProvider, MentionKind, MENTION_KINDS } from "./provider";

// Curated list of well-known doc sources. Sidecar resolves to real URLs.
const DOC_SOURCES: ReadonlyArray<{ label: string; slug: string; detail: string }> = [
  { label: "React", slug: "react", detail: "react.dev" },
  { label: "Next.js", slug: "nextjs", detail: "nextjs.org/docs" },
  { label: "TypeScript", slug: "typescript", detail: "typescriptlang.org" },
  { label: "Node.js", slug: "node", detail: "nodejs.org/docs" },
  { label: "Tailwind", slug: "tailwind", detail: "tailwindcss.com" },
  { label: "Rust std", slug: "rust-std", detail: "doc.rust-lang.org/std" },
  { label: "Python", slug: "python", detail: "docs.python.org" },
  { label: "MDN Web", slug: "mdn", detail: "developer.mozilla.org" },
];

// Limit how many files we surface to keep the picker snappy on large repos.
const FILE_PICK_LIMIT = 1000;

export function activateMentions(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
): void {
  const provider = new EriMentionCompletionProvider();

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      [
        { scheme: "file" },
        { scheme: "untitled" },
        { scheme: "vscode-userdata" },
      ],
      provider,
      "@",
    ),
    vscode.commands.registerCommand("eri.mentions.openPicker", () => openTopLevelPicker()),
    vscode.commands.registerCommand("eri.mentions.pickFile", () => pickFile(getSidecar())),
    vscode.commands.registerCommand("eri.mentions.pickFolder", () => pickFolder(getSidecar())),
    vscode.commands.registerCommand("eri.mentions.pickSymbol", () => pickSymbol(getSidecar())),
    vscode.commands.registerCommand("eri.mentions.pickWeb", () => pickWeb(getSidecar())),
    vscode.commands.registerCommand("eri.mentions.pickDocs", () => pickDocs(getSidecar())),
    vscode.commands.registerCommand("eri.mentions.pickCodebase", () => pickCodebase(getSidecar())),
  );
}

async function openTopLevelPicker(): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    MENTION_KINDS.map((kind) => ({
      label: `${kind.icon} ${kind.label}`,
      description: kind.description,
      kindId: kind.id,
    })),
    {
      placeHolder: "Attach context to your eri prompt",
      matchOnDescription: true,
    },
  );
  if (!choice) {
    return;
  }
  await dispatchKind(choice.kindId);
}

async function dispatchKind(kind: MentionKind): Promise<void> {
  const command = `eri.mentions.pick${capitalize(kind)}`;
  await vscode.commands.executeCommand(command);
}

function capitalize(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function pickFile(sidecar: Sidecar | null): Promise<void> {
  const uris = await vscode.workspace.findFiles(
    "**/*",
    "**/{node_modules,.git,target,dist,out,build}/**",
    FILE_PICK_LIMIT,
  );
  if (uris.length === 0) {
    vscode.window.showInformationMessage("eri mentions — no files in this workspace");
    return;
  }
  const items = uris.map((uri) => ({
    label: vscode.workspace.asRelativePath(uri),
    description: uri.fsPath,
    uri,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Pick a file to mention",
    matchOnDescription: true,
  });
  if (!picked) {
    return;
  }
  await insertMention(`@file:${picked.label}`);
  sidecar?.notify("eri/mentions/attached", {
    kind: "file",
    path: picked.uri.fsPath,
  });
}

async function pickFolder(sidecar: Sidecar | null): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    vscode.window.showInformationMessage("eri mentions — open a folder to mention directories");
    return;
  }
  const files = await vscode.workspace.findFiles(
    "**/*",
    "**/{node_modules,.git,target,dist,out,build}/**",
    FILE_PICK_LIMIT,
  );
  const directorySet = new Set<string>();
  for (const folder of folders) {
    directorySet.add(folder.name);
  }
  for (const file of files) {
    const relative = vscode.workspace.asRelativePath(file);
    const parts = relative.split("/");
    parts.pop();
    let accumulator = "";
    for (const part of parts) {
      accumulator = accumulator.length === 0 ? part : `${accumulator}/${part}`;
      directorySet.add(accumulator);
    }
  }
  const items = Array.from(directorySet)
    .sort()
    .map((path) => ({ label: path }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Pick a folder to mention",
  });
  if (!picked) {
    return;
  }
  await insertMention(`@folder:${picked.label}`);
  sidecar?.notify("eri/mentions/attached", {
    kind: "folder",
    path: picked.label,
  });
}

async function pickSymbol(sidecar: Sidecar | null): Promise<void> {
  const query = await vscode.window.showInputBox({
    prompt: "Search workspace symbols",
    placeHolder: "Type a class, function, or variable name",
  });
  if (query === undefined) {
    return;
  }
  const symbols = (await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
    "vscode.executeWorkspaceSymbolProvider",
    query,
  )) ?? [];
  if (symbols.length === 0) {
    vscode.window.showInformationMessage(`eri mentions — no symbols matched "${query}"`);
    return;
  }
  const items = symbols.slice(0, 200).map((symbol) => ({
    label: symbol.name,
    description: vscode.SymbolKind[symbol.kind] ?? "Symbol",
    detail: vscode.workspace.asRelativePath(symbol.location.uri),
    symbol,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Pick a symbol to mention",
    matchOnDetail: true,
  });
  if (!picked) {
    return;
  }
  const location = picked.symbol.location;
  await insertMention(`@symbol:${picked.label}`);
  sidecar?.notify("eri/mentions/attached", {
    kind: "symbol",
    name: picked.symbol.name,
    path: location.uri.fsPath,
    range: {
      startLine: location.range.start.line,
      startColumn: location.range.start.character,
      endLine: location.range.end.line,
      endColumn: location.range.end.character,
    },
  });
}

async function pickWeb(sidecar: Sidecar | null): Promise<void> {
  const query = await vscode.window.showInputBox({
    prompt: "Search the web for context",
    placeHolder: "Question or URL",
  });
  if (!query || query.trim().length === 0) {
    return;
  }
  const trimmed = query.trim();
  await insertMention(`@web:${trimmed}`);
  const active = sidecar;
  if (!active) {
    vscode.window.showWarningMessage("eri mentions — sidecar offline, web request not sent");
    return;
  }
  try {
    await active.request("eri/web/search", { query: trimmed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showWarningMessage(`eri web search failed: ${message}`);
  }
}

async function pickDocs(sidecar: Sidecar | null): Promise<void> {
  const items = DOC_SOURCES.map((source) => ({
    label: source.label,
    description: source.detail,
    slug: source.slug,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Pick a documentation source",
    matchOnDescription: true,
  });
  if (!picked) {
    return;
  }
  const topic = await vscode.window.showInputBox({
    prompt: `Topic in ${picked.label} docs`,
    placeHolder: "Leave empty to attach the whole source",
  });
  if (topic === undefined) {
    return;
  }
  const trimmedTopic = topic.trim();
  const mention = trimmedTopic.length === 0
    ? `@docs:${picked.slug}`
    : `@docs:${picked.slug}#${trimmedTopic}`;
  await insertMention(mention);
  const active = sidecar;
  if (!active) {
    vscode.window.showWarningMessage("eri mentions — sidecar offline, docs request not sent");
    return;
  }
  try {
    await active.request("eri/docs/fetch", {
      source: picked.slug,
      topic: trimmedTopic.length === 0 ? null : trimmedTopic,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showWarningMessage(`eri docs fetch failed: ${message}`);
  }
}

async function pickCodebase(sidecar: Sidecar | null): Promise<void> {
  const query = await vscode.window.showInputBox({
    prompt: "Semantic search the codebase",
    placeHolder: "Describe what you want to find",
  });
  if (!query || query.trim().length === 0) {
    return;
  }
  const trimmed = query.trim();
  await insertMention(`@codebase:${trimmed}`);
  const active = sidecar;
  if (!active) {
    vscode.window.showWarningMessage("eri mentions — sidecar offline, codebase search not sent");
    return;
  }
  try {
    await active.request("eri/index/semanticSearch", {
      query: trimmed,
      limit: 20,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showWarningMessage(`eri codebase search failed: ${message}`);
  }
}

// Inserts the mention into the active editor when one exists. Otherwise the
// payload is staged in the sidecar, so the chat composer can attach it later.
async function insertMention(text: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage(`eri — copied ${text} to clipboard`);
    return;
  }
  await editor.edit((builder) => {
    for (const selection of editor.selections) {
      builder.replace(selection, text);
    }
  });
}
