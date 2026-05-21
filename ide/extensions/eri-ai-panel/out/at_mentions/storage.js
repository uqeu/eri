"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocSourceStore = exports.PastChatStore = void 0;
const vscode = require("vscode");
// Past chats are persisted in globalState keyed by workspace. The composer is
// the source of truth — we just hold the index here so @PastChats can list
// them and resolve the full transcript on demand.
const PAST_CHATS_KEY = "eri.atMentions.pastChats.v1";
const CUSTOM_DOCS_KEY = "eri.atMentions.customDocs.v1";
class PastChatStore {
    context;
    constructor(context) {
        this.context = context;
    }
    async list() {
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
    async load(id) {
        const entry = this.readAll().find((chat) => chat.id === id);
        return entry ? entry.transcript : null;
    }
    async save(title, transcript) {
        const id = `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const all = this.readAll();
        const next = {
            id,
            workspaceKey: this.workspaceKey(),
            title: title.length > 0 ? title : "(untitled chat)",
            updatedAt: Date.now(),
            transcript,
        };
        await this.context.globalState.update(PAST_CHATS_KEY, [...all, next]);
        return id;
    }
    readAll() {
        return this.context.globalState.get(PAST_CHATS_KEY, []);
    }
    workspaceKey() {
        const folders = vscode.workspace.workspaceFolders ?? [];
        return folders.map((folder) => folder.uri.fsPath).join("|") || "(no-workspace)";
    }
}
exports.PastChatStore = PastChatStore;
class DocSourceStore {
    context;
    builtIn;
    constructor(context, builtIn) {
        this.context = context;
        this.builtIn = builtIn;
    }
    list() {
        const custom = this.context.globalState.get(CUSTOM_DOCS_KEY, []);
        const seen = new Set(this.builtIn.map((source) => source.slug));
        const combined = [...this.builtIn];
        for (const entry of custom) {
            if (!seen.has(entry.slug)) {
                combined.push(entry);
                seen.add(entry.slug);
            }
        }
        return combined;
    }
    async add(source) {
        const current = this.context.globalState.get(CUSTOM_DOCS_KEY, []);
        const filtered = current.filter((entry) => entry.slug !== source.slug);
        await this.context.globalState.update(CUSTOM_DOCS_KEY, [...filtered, source]);
    }
}
exports.DocSourceStore = DocSourceStore;
//# sourceMappingURL=storage.js.map