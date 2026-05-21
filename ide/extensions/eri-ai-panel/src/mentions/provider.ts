import * as vscode from "vscode";

export type MentionKind = "file" | "folder" | "symbol" | "web" | "docs" | "codebase";

interface MentionDescriptor {
  readonly id: MentionKind;
  readonly label: string;
  readonly icon: string;
  readonly description: string;
}

export const MENTION_KINDS: ReadonlyArray<MentionDescriptor> = [
  {
    id: "file",
    label: "File",
    icon: "$(file-code)",
    description: "Attach a file from this workspace",
  },
  {
    id: "folder",
    label: "Folder",
    icon: "$(file-directory)",
    description: "Attach an entire directory",
  },
  {
    id: "symbol",
    label: "Symbol",
    icon: "$(symbol-namespace)",
    description: "Attach a workspace symbol (class, function, type)",
  },
  {
    id: "web",
    label: "Web",
    icon: "$(globe)",
    description: "Search the web through the eri sidecar",
  },
  {
    id: "docs",
    label: "Docs",
    icon: "$(book)",
    description: "Attach official documentation",
  },
  {
    id: "codebase",
    label: "Codebase",
    icon: "$(search-fuzzy)",
    description: "Semantic search across the indexed codebase",
  },
];

export class EriMentionCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    if (!this.triggeredOnMentionChar(document, position)) {
      return undefined;
    }
    return MENTION_KINDS.map((kind) => this.toCompletionItem(kind, position));
  }

  // We only want to surface mentions when the user actually typed `@`. A bare
  // `@` at start of line counts; otherwise the previous char must be whitespace
  // so we don't fire inside email addresses or decorators.
  private triggeredOnMentionChar(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): boolean {
    if (position.character === 0) {
      return false;
    }
    const lineText = document.lineAt(position.line).text;
    const previousChar = lineText.charAt(position.character - 1);
    if (previousChar !== "@") {
      return false;
    }
    if (position.character === 1) {
      return true;
    }
    const charBeforeAt = lineText.charAt(position.character - 2);
    return /\s/.test(charBeforeAt);
  }

  private toCompletionItem(
    descriptor: MentionDescriptor,
    position: vscode.Position,
  ): vscode.CompletionItem {
    const item = new vscode.CompletionItem(
      `${descriptor.label}`,
      vscode.CompletionItemKind.Reference,
    );
    item.detail = `eri mention — ${descriptor.description}`;
    item.documentation = new vscode.MarkdownString(
      `Insert an **eri ${descriptor.label}** mention. Selecting this entry opens the matching picker.`,
    );
    item.sortText = `eri-mention-${descriptor.id}`;
    item.filterText = `@${descriptor.id}`;
    // Replace the `@` the user just typed so the picker output owns the final text.
    const replaceRange = new vscode.Range(
      position.line,
      Math.max(0, position.character - 1),
      position.line,
      position.character,
    );
    item.range = replaceRange;
    item.insertText = "";
    item.command = {
      command: `eri.mentions.pick${capitalize(descriptor.id)}`,
      title: `eri: Mention ${descriptor.label}`,
    };
    return item;
  }
}

function capitalize(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}
