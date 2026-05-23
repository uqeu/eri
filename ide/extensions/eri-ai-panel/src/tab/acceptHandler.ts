import * as vscode from "vscode";

// Partial-accept commands rely on VS Code's built-in inline-suggestion controller.
// We forward to the closest native commands so the ghost text state stays
// consistent with the editor's own session bookkeeping.

async function tryExecute(commandIds: readonly string[]): Promise<boolean> {
  for (const id of commandIds) {
    try {
      await vscode.commands.executeCommand(id);
      return true;
    } catch (err) {
      void err;
    }
  }
  return false;
}

async function acceptWord(): Promise<void> {
  const accepted = await tryExecute([
    "editor.action.inlineSuggest.acceptNextWord",
  ]);
  if (!accepted) {
    vscode.window.setStatusBarMessage("eri: no inline suggestion to partial-accept", 1500);
  }
}

async function acceptLine(): Promise<void> {
  const accepted = await tryExecute([
    "editor.action.inlineSuggest.acceptNextLine",
    "editor.action.inlineSuggest.commit",
  ]);
  if (!accepted) {
    vscode.window.setStatusBarMessage("eri: no inline suggestion to partial-accept", 1500);
  }
}

export function registerAcceptHandlers(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("eri.tab.acceptWord", acceptWord),
    vscode.commands.registerCommand("eri.tab.acceptLine", acceptLine),
  );
}
