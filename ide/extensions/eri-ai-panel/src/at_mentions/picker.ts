import { exec } from "child_process";
import { promisify } from "util";
import * as vscode from "vscode";
import {
  AT_MENTION_KINDS,
  AtMentionChip,
  AtMentionDescriptor,
  AtMentionKind,
  AtMentionRegistry,
} from "./registry";
import { BUILT_IN_DOC_SOURCES, DocSource } from "./resolvers";

const execAsync = promisify(exec);

const FILE_PICK_LIMIT = 1000;
const SYMBOL_PICK_LIMIT = 200;

export interface PastChatSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt?: number;
}

export interface PickerDeps {
  readonly registry: AtMentionRegistry;
  readonly listPastChats: () => Promise<ReadonlyArray<PastChatSummary>>;
  readonly listDocSources: () => ReadonlyArray<DocSource>;
}

export class AtMentionPicker {
  constructor(private readonly deps: PickerDeps) {}

  async openTopLevel(): Promise<AtMentionChip | undefined> {
    const enabled = this.deps.registry.enabledKinds();
    if (enabled.length === 0) {
      vscode.window.showInformationMessage(
        "eri @-mentions — all mention types are disabled. Run 'eri: Manage @-mentions' to enable some.",
      );
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      enabled.map((descriptor) => ({
        label: `${descriptor.icon} ${descriptor.token}`,
        description: descriptor.description,
        kindId: descriptor.id,
      })),
      {
        placeHolder: "Add context — pick a mention kind",
        matchOnDescription: true,
      },
    );
    if (!picked) {
      return undefined;
    }
    return this.openKind(picked.kindId);
  }

  async openKind(kind: AtMentionKind): Promise<AtMentionChip | undefined> {
    const descriptor = this.deps.registry.descriptor(kind);
    if (!descriptor) {
      return undefined;
    }
    if (!this.deps.registry.isEnabled(kind)) {
      vscode.window.showInformationMessage(
        `eri @-mentions — ${descriptor.token} is disabled. Enable it via 'eri: Manage @-mentions'.`,
      );
      return undefined;
    }
    switch (kind) {
      case "file": return this.pickFile(descriptor);
      case "folder": return this.pickFolder(descriptor);
      case "code": return this.pickCode(descriptor);
      case "docs": return this.pickDocs(descriptor);
      case "web": return this.pickWeb(descriptor);
      case "codebase": return this.pickCodebase(descriptor);
      case "git": return this.pickGit(descriptor);
      case "pastChats": return this.pickPastChats(descriptor);
      case "recentChanges": return this.pickRecentChanges(descriptor);
      case "linterErrors": return this.pickLinterErrors(descriptor);
      case "definitions": return this.pickDefinitions(descriptor);
      case "codemap": return this.pickCodemap(descriptor);
      default: return undefined;
    }
  }

  private async pickCodemap(_descriptor: AtMentionDescriptor): Promise<AtMentionChip | undefined> {
    // The actual list comes from the sidecar at resolve time; the picker
    // only collects a free-form name from the user. This keeps the picker
    // synchronous and avoids round-tripping over JSON-RPC just to fill in a
    // dropdown — names tend to be short ("module", "hotspot", etc.).
    const name = await vscode.window.showInputBox({
      prompt: "Codemap name (e.g. 'module' or 'hotspot')",
      placeHolder: "module",
    });
    if (!name) {
      return undefined;
    }
    return {
      kind: "codemap",
      label: name,
      subtitle: "codemap",
      payload: { name },
    };
  }

  // ---------- individual pickers ----------

  private async pickFile(_descriptor: AtMentionDescriptor): Promise<AtMentionChip | undefined> {
    const uris = await vscode.workspace.findFiles(
      "**/*",
      "**/{node_modules,.git,target,dist,out,build}/**",
      FILE_PICK_LIMIT,
    );
    if (uris.length === 0) {
      vscode.window.showInformationMessage("eri @File — no files in this workspace");
      return undefined;
    }
    const items = uris.map((uri) => ({
      label: vscode.workspace.asRelativePath(uri),
      description: uri.fsPath,
      uri,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "@File — pick a file",
      matchOnDescription: true,
    });
    if (!picked) {
      return undefined;
    }
    return {
      kind: "file",
      label: picked.label,
      subtitle: picked.uri.fsPath,
      payload: { fsPath: picked.uri.fsPath },
    };
  }

  private async pickFolder(_descriptor: AtMentionDescriptor): Promise<AtMentionChip | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      vscode.window.showInformationMessage("eri @Folder — open a folder first");
      return undefined;
    }
    const files = await vscode.workspace.findFiles(
      "**/*",
      "**/{node_modules,.git,target,dist,out,build}/**",
      FILE_PICK_LIMIT,
    );
    const directories = new Set<string>();
    directories.add(".");
    for (const file of files) {
      const relative = vscode.workspace.asRelativePath(file);
      const parts = relative.split("/");
      parts.pop();
      let accumulator = "";
      for (const part of parts) {
        accumulator = accumulator.length === 0 ? part : `${accumulator}/${part}`;
        directories.add(accumulator);
      }
    }
    const items = Array.from(directories).sort().map((value) => ({
      label: value,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "@Folder — pick a folder",
    });
    if (!picked) {
      return undefined;
    }
    return {
      kind: "folder",
      label: picked.label,
      payload: { path: picked.label },
    };
  }

  private async pickCode(_descriptor: AtMentionDescriptor): Promise<AtMentionChip | undefined> {
    const query = await vscode.window.showInputBox({
      prompt: "@Code — search workspace symbols",
      placeHolder: "Type a class, function, or variable name",
    });
    if (query === undefined) {
      return undefined;
    }
    const symbols = (await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      query,
    )) ?? [];
    if (symbols.length === 0) {
      vscode.window.showInformationMessage(`eri @Code — no symbols matched "${query}"`);
      return undefined;
    }
    const items = symbols.slice(0, SYMBOL_PICK_LIMIT).map((symbol) => ({
      label: symbol.name,
      description: vscode.SymbolKind[symbol.kind] ?? "Symbol",
      detail: vscode.workspace.asRelativePath(symbol.location.uri),
      symbol,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "@Code — pick a symbol",
      matchOnDetail: true,
    });
    if (!picked) {
      return undefined;
    }
    const location = picked.symbol.location;
    return {
      kind: "code",
      label: picked.symbol.name,
      subtitle: `${picked.detail}:${location.range.start.line + 1}`,
      payload: {
        name: picked.symbol.name,
        fsPath: location.uri.fsPath,
        startLine: location.range.start.line,
        endLine: location.range.end.line,
      },
    };
  }

  private async pickDocs(_descriptor: AtMentionDescriptor): Promise<AtMentionChip | undefined> {
    const sources = this.deps.listDocSources();
    if (sources.length === 0) {
      vscode.window.showInformationMessage(
        "eri @Docs — no doc sources configured. Run 'eri: Add Doc Source'.",
      );
      return undefined;
    }
    const items = sources.map((source) => ({
      label: source.label,
      description: source.url,
      slug: source.slug,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "@Docs — pick a documentation source",
      matchOnDescription: true,
    });
    if (!picked) {
      return undefined;
    }
    return {
      kind: "docs",
      label: picked.label,
      subtitle: picked.description,
      payload: { slug: picked.slug, url: picked.description },
    };
  }

  private async pickWeb(_descriptor: AtMentionDescriptor): Promise<AtMentionChip | undefined> {
    const editor = vscode.window.activeTextEditor;
    const selection = editor && !editor.selection.isEmpty
      ? editor.document.getText(editor.selection).trim()
      : "";
    const query = await vscode.window.showInputBox({
      prompt: "@Web — what should I search for?",
      placeHolder: "Question or topic",
      value: selection,
    });
    if (!query || query.trim().length === 0) {
      return undefined;
    }
    const trimmed = query.trim();
    return {
      kind: "web",
      label: trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed,
      subtitle: "web search",
      payload: { query: trimmed },
    };
  }

  private async pickCodebase(_descriptor: AtMentionDescriptor): Promise<AtMentionChip | undefined> {
    const query = await vscode.window.showInputBox({
      prompt: "@Codebase — semantic search",
      placeHolder: "Describe what you want to find",
    });
    if (!query || query.trim().length === 0) {
      return undefined;
    }
    const trimmed = query.trim();
    return {
      kind: "codebase",
      label: trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed,
      subtitle: "semantic search",
      payload: { query: trimmed },
    };
  }

  private async pickGit(_descriptor: AtMentionDescriptor): Promise<AtMentionChip | undefined> {
    const subKind = await vscode.window.showQuickPick(
      [
        { label: "Commit", description: "Pick from the last 50 commits", id: "commit" as const },
        { label: "Branch", description: "Pick a branch and attach recent history", id: "branch" as const },
        { label: "Diff", description: "Diff against a ref (default: HEAD)", id: "diff" as const },
      ],
      { placeHolder: "@Git — what do you want to attach?" },
    );
    if (!subKind) {
      return undefined;
    }
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      vscode.window.showInformationMessage("eri @Git — open a folder first");
      return undefined;
    }
    if (subKind.id === "commit") {
      try {
        const { stdout } = await execAsync(
          'git log --pretty=format:"%h%x09%an%x09%s" -n 50',
          { cwd },
        );
        const items = stdout
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => {
            const [sha, author, ...subjectParts] = line.split("\t");
            const subject = subjectParts.join("\t");
            return {
              label: sha,
              description: subject,
              detail: author,
              sha,
            };
          });
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: "@Git — pick a commit",
          matchOnDescription: true,
          matchOnDetail: true,
        });
        if (!picked) {
          return undefined;
        }
        return {
          kind: "git",
          label: `commit ${picked.sha}`,
          subtitle: picked.description,
          payload: { gitKind: "commit", ref: picked.sha },
        };
      } catch (err) {
        vscode.window.showWarningMessage(`eri @Git — ${errorMessage(err)}`);
        return undefined;
      }
    }
    if (subKind.id === "branch") {
      try {
        const { stdout } = await execAsync("git branch --list --all", { cwd });
        const branches = stdout
          .split("\n")
          .map((line) => line.replace(/^[\s*]+/, "").trim())
          .filter((line) => line.length > 0);
        const picked = await vscode.window.showQuickPick(branches, {
          placeHolder: "@Git — pick a branch",
        });
        if (!picked) {
          return undefined;
        }
        return {
          kind: "git",
          label: `branch ${picked}`,
          payload: { gitKind: "branch", ref: picked },
        };
      } catch (err) {
        vscode.window.showWarningMessage(`eri @Git — ${errorMessage(err)}`);
        return undefined;
      }
    }
    const ref = await vscode.window.showInputBox({
      prompt: "@Git diff — ref to diff against",
      value: "HEAD",
    });
    if (ref === undefined) {
      return undefined;
    }
    return {
      kind: "git",
      label: `diff ${ref}`,
      payload: { gitKind: "diff", ref },
    };
  }

  private async pickPastChats(_descriptor: AtMentionDescriptor): Promise<AtMentionChip | undefined> {
    const chats = await this.deps.listPastChats();
    if (chats.length === 0) {
      vscode.window.showInformationMessage(
        "eri @PastChats — no saved chats yet in this workspace",
      );
      return undefined;
    }
    const items = chats.map((chat) => ({
      label: chat.title,
      description: chat.updatedAt ? new Date(chat.updatedAt).toLocaleString() : undefined,
      id: chat.id,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "@PastChats — pick a prior conversation",
    });
    if (!picked) {
      return undefined;
    }
    return {
      kind: "pastChats",
      label: picked.label,
      subtitle: picked.description,
      payload: { id: picked.id },
    };
  }

  private async pickRecentChanges(_descriptor: AtMentionDescriptor): Promise<AtMentionChip | undefined> {
    // No additional input required.
    return {
      kind: "recentChanges",
      label: "working tree",
      subtitle: "git status + diff --stat",
      payload: {},
    };
  }

  private async pickLinterErrors(_descriptor: AtMentionDescriptor): Promise<AtMentionChip | undefined> {
    return {
      kind: "linterErrors",
      label: "current diagnostics",
      subtitle: "errors + warnings",
      payload: {},
    };
  }

  private async pickDefinitions(_descriptor: AtMentionDescriptor): Promise<AtMentionChip | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage(
        "eri @Definitions — place the cursor in an open editor first",
      );
      return undefined;
    }
    const position = editor.selection.active;
    return {
      kind: "definitions",
      label: `${vscode.workspace.asRelativePath(editor.document.uri)}:${position.line + 1}`,
      subtitle: "near cursor",
      payload: {
        fsPath: editor.document.uri.fsPath,
        line: position.line,
        character: position.character,
      },
    };
  }
}

export function defaultDocSources(): ReadonlyArray<DocSource> {
  return BUILT_IN_DOC_SOURCES;
}

// Re-export the descriptor list so callers can render UI without touching the
// registry.
export function allDescriptors(): ReadonlyArray<AtMentionDescriptor> {
  return AT_MENTION_KINDS;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
