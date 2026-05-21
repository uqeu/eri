import * as vscode from "vscode";
import { AtMentionRegistry } from "../at_mentions/registry";
import { EriMentionCompletionProvider } from "./provider";

// Wires the `@` completion provider into every text editor. The picker
// commands themselves live in `../at_mentions/index.ts` — this file only
// keeps the inline-typing entrypoint so `@` in any editor still surfaces the
// mention vocabulary.
export function activateMentionCompletions(
  context: vscode.ExtensionContext,
  registry: AtMentionRegistry,
): void {
  const provider = new EriMentionCompletionProvider(registry);
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
  );
}
