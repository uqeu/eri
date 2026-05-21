import * as vscode from "vscode";
import { PastChatSummary } from "./picker";
import { DocSource } from "./resolvers";

// Past chats are persisted in globalState keyed by workspace. The composer is
// the source of truth — we just hold the index here so @PastChats can list
// them and resolve the full transcript on demand.
const PAST_CHATS_KEY = "eri.atMentions.pastChats.v1";
const CUSTOM_DOCS_KEY = "eri.atMentions.customDocs.v1";

interface StoredPastChat {
  readonly id: string;
  readonly workspaceKey: string;
  readonly title: string;
  readonly updatedAt: number;
  readonly transcript: string;
}

export class PastChatStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async list(): Promise<ReadonlyArray<PastChatSummary>> {
    const workspaceKey = this.workspaceKey();
    return this.readAll()
      .filter((chat) => chat.workspaceKey === workspaceKey)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((chat) => ({
        id: chat.id,
        title: chat.title,
        updatedAt: chat.updatedAt,
      }));
  }

  async load(id: string): Promise<string | null> {
    const entry = this.readAll().find((chat) => chat.id === id);
    return entry ? entry.transcript : null;
  }

  async save(title: string, transcript: string): Promise<string> {
    const id = `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const all = this.readAll();
    const next: StoredPastChat = {
      id,
      workspaceKey: this.workspaceKey(),
      title: title.length > 0 ? title : "(untitled chat)",
      updatedAt: Date.now(),
      transcript,
    };
    await this.context.globalState.update(PAST_CHATS_KEY, [...all, next]);
    return id;
  }

  private readAll(): ReadonlyArray<StoredPastChat> {
    return this.context.globalState.get<ReadonlyArray<StoredPastChat>>(
      PAST_CHATS_KEY,
      [],
    );
  }

  private workspaceKey(): string {
    const folders = vscode.workspace.workspaceFolders ?? [];
    return folders.map((folder) => folder.uri.fsPath).join("|") || "(no-workspace)";
  }
}

export class DocSourceStore {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly builtIn: ReadonlyArray<DocSource>,
  ) {}

  list(): ReadonlyArray<DocSource> {
    const custom = this.context.globalState.get<ReadonlyArray<DocSource>>(
      CUSTOM_DOCS_KEY,
      [],
    );
    const seen = new Set(this.builtIn.map((source) => source.slug));
    const combined: DocSource[] = [...this.builtIn];
    for (const entry of custom) {
      if (!seen.has(entry.slug)) {
        combined.push(entry);
        seen.add(entry.slug);
      }
    }
    return combined;
  }

  async add(source: DocSource): Promise<void> {
    const current = this.context.globalState.get<ReadonlyArray<DocSource>>(
      CUSTOM_DOCS_KEY,
      [],
    );
    const filtered = current.filter((entry) => entry.slug !== source.slug);
    await this.context.globalState.update(CUSTOM_DOCS_KEY, [...filtered, source]);
  }
}
