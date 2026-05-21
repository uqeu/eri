import * as vscode from "vscode";
import { AT_MENTION_KINDS, AtMentionRegistry } from "../at_mentions/registry";

// Surfaces the 11 @-mention kinds as completion items inside any text editor.
// When the user selects one we forward to the matching `eri.mentions.pick*`
// command, which opens the QuickPick picker.
export class EriMentionCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly registry: AtMentionRegistry) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    if (!this.triggeredOnMentionChar(document, position)) {
      return undefined;
    }
    return AT_MENTION_KINDS
      .filter((descriptor) => this.registry.isEnabled(descriptor.id))
      .map((descriptor) => this.toCompletionItem(descriptor, position));
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
    descriptor: typeof AT_MENTION_KINDS[number],
    position: vscode.Position,
  ): vscode.CompletionItem {
    const item = new vscode.CompletionItem(
      descriptor.token,
      vscode.CompletionItemKind.Reference,
    );
    item.detail = `eri @-mention — ${descriptor.description}`;
    item.documentation = new vscode.MarkdownString(
      `Insert an **eri ${descriptor.token}** mention. Selecting this entry opens the matching picker.`,
    );
    item.sortText = `eri-mention-${descriptor.id}`;
    item.filterText = descriptor.token;
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
      title: `eri: Mention ${descriptor.token}`,
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
