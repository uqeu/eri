import * as vscode from "vscode";

// The 11 mention kinds eri supports. The ordering here is the order shown in
// the top-level picker — keep the most common first.
export type AtMentionKind =
  | "file"
  | "folder"
  | "code"
  | "docs"
  | "web"
  | "codebase"
  | "git"
  | "pastChats"
  | "recentChanges"
  | "linterErrors"
  | "definitions"
  | "codemap";

export interface AtMentionDescriptor {
  readonly id: AtMentionKind;
  readonly label: string;
  readonly token: string;
  readonly icon: string;
  readonly description: string;
}

export const AT_MENTION_KINDS: ReadonlyArray<AtMentionDescriptor> = [
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
];

// Storage key for per-workspace enable/disable toggles. Persisted via
// context.globalState because the user picks once and rarely changes.
const ENABLED_STATE_KEY = "eri.atMentions.enabled.v1";

export class AtMentionRegistry {
  constructor(private readonly context: vscode.ExtensionContext) {}

  isEnabled(kind: AtMentionKind): boolean {
    const state = this.readState();
    if (state[kind] === false) {
      return false;
    }
    return true;
  }

  setEnabled(kind: AtMentionKind, enabled: boolean): Thenable<void> {
    const state = { ...this.readState(), [kind]: enabled };
    return this.context.globalState.update(ENABLED_STATE_KEY, state);
  }

  enabledKinds(): ReadonlyArray<AtMentionDescriptor> {
    return AT_MENTION_KINDS.filter((descriptor) =>
      this.isEnabled(descriptor.id),
    );
  }

  descriptor(kind: AtMentionKind): AtMentionDescriptor | undefined {
    return AT_MENTION_KINDS.find((entry) => entry.id === kind);
  }

  private readState(): Partial<Record<AtMentionKind, boolean>> {
    const raw = this.context.globalState.get<Partial<Record<AtMentionKind, boolean>>>(
      ENABLED_STATE_KEY,
      {},
    );
    return raw ?? {};
  }
}

// A picked mention chip the composer will display. `payload` is what
// resolvers consume; `subtitle` is shown next to the chip.
export interface AtMentionChip {
  readonly kind: AtMentionKind;
  readonly label: string;
  readonly subtitle?: string;
  readonly payload: Record<string, unknown>;
}

// Resolved context block ready to be glued into the final prompt.
export interface ResolvedContext {
  readonly heading: string;
  readonly body: string;
  readonly pending?: boolean;
}
