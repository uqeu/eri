"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AtMentionRegistry = exports.AT_MENTION_KINDS = void 0;
exports.AT_MENTION_KINDS = [
    {
        id: "file",
        label: "File",
        token: "@File",
        icon: "$(file-code)",
        description: "Attach a file from this workspace",
    },
    {
        id: "folder",
        label: "Folder",
        token: "@Folder",
        icon: "$(file-directory)",
        description: "Attach an entire folder",
    },
    {
        id: "code",
        label: "Code",
        token: "@Code",
        icon: "$(symbol-namespace)",
        description: "Attach a workspace symbol (class, function, type)",
    },
    {
        id: "docs",
        label: "Docs",
        token: "@Docs",
        icon: "$(book)",
        description: "Attach official library documentation",
    },
    {
        id: "web",
        label: "Web",
        token: "@Web",
        icon: "$(globe)",
        description: "Search the web through the eri sidecar",
    },
    {
        id: "codebase",
        label: "Codebase",
        token: "@Codebase",
        icon: "$(search-fuzzy)",
        description: "Semantic search across the indexed codebase",
    },
    {
        id: "git",
        label: "Git",
        token: "@Git",
        icon: "$(git-commit)",
        description: "Attach a commit, branch, or diff",
    },
    {
        id: "pastChats",
        label: "PastChats",
        token: "@PastChats",
        icon: "$(comment-discussion)",
        description: "Reference a prior chat session in this workspace",
    },
    {
        id: "recentChanges",
        label: "RecentChanges",
        token: "@RecentChanges",
        icon: "$(diff)",
        description: "Attach the working tree's uncommitted changes",
    },
    {
        id: "linterErrors",
        label: "LinterErrors",
        token: "@LinterErrors",
        icon: "$(warning)",
        description: "Attach current linter/diagnostics errors and warnings",
    },
    {
        id: "definitions",
        label: "Definitions",
        token: "@Definitions",
        icon: "$(symbol-method)",
        description: "Attach definitions referenced near the cursor",
    },
    {
        id: "codemap",
        label: "Codemap",
        token: "@Codemap",
        icon: "$(graph)",
        description: "Attach a saved codemap (module/hotspot/function/data)",
    },
    {
        id: "image",
        label: "Image",
        token: "@Image",
        icon: "$(file-media)",
        description: "Attach a screenshot or design mock as a multimodal input",
    },
];
// Storage key for per-workspace enable/disable toggles. Persisted via
// context.globalState because the user picks once and rarely changes.
const ENABLED_STATE_KEY = "eri.atMentions.enabled.v1";
class AtMentionRegistry {
    context;
    constructor(context) {
        this.context = context;
    }
    isEnabled(kind) {
        const state = this.readState();
        if (state[kind] === false) {
            return false;
        }
        return true;
    }
    setEnabled(kind, enabled) {
        const state = { ...this.readState(), [kind]: enabled };
        return this.context.globalState.update(ENABLED_STATE_KEY, state);
    }
    enabledKinds() {
        return exports.AT_MENTION_KINDS.filter((descriptor) => this.isEnabled(descriptor.id));
    }
    descriptor(kind) {
        return exports.AT_MENTION_KINDS.find((entry) => entry.id === kind);
    }
    readState() {
        const raw = this.context.globalState.get(ENABLED_STATE_KEY, {});
        return raw ?? {};
    }
}
exports.AtMentionRegistry = AtMentionRegistry;
//# sourceMappingURL=registry.js.map