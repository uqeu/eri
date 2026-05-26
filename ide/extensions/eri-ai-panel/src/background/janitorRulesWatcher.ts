// IDE-side wiring for event-triggered Janitor rules (Phase 17a).
//
// On workspace activation we load the parsed rule set via
// `eri/background/rules`, then subscribe to `onDidSaveTextDocument`
// and dispatch the matching rule's `run` command whenever the saved
// path matches a `save:<glob>` trigger.
//
// Discipline:
//   - Per-rule debounce: each rule fires at most once per second so
//     a save storm (e.g. format-on-save touching 20 files at once)
//     can't dispatch 20 ships.
//   - Opt-in: the watcher only fires when
//     `eri.background.rulesEnabled` is true (default false). Keeps
//     existing workflows quiet by default.
//   - The actual command dispatch goes through `vscode.commands.executeCommand`
//     so eri's own slash commands and any other extension commands
//     in the workspace are eligible targets.

import * as vscode from "vscode";
import type { Sidecar } from "../sidecar";
import { matchesSaveGlob } from "./saveGlob";

interface ParsedRule {
  readonly id: string;
  readonly on: string;
  readonly run: string;
  readonly description?: string;
}

interface RulesResponse {
  readonly rules: ParsedRule[];
}

interface WatcherDeps {
  readonly workspaceRoot: string;
  readonly getSidecar: () => Sidecar | null;
}

const DEBOUNCE_MS = 1_000;

export function activateJanitorRulesWatcher(
  context: vscode.ExtensionContext,
  deps: WatcherDeps,
): vscode.Disposable {
  let rules: ParsedRule[] = [];
  const lastFired = new Map<string, number>();

  const refresh = async (): Promise<void> => {
    const enabled = vscode.workspace
      .getConfiguration("eri.background")
      .get<boolean>("rulesEnabled", false);
    if (!enabled) {
      rules = [];
      return;
    }
    const sidecar = deps.getSidecar();
    if (!sidecar) {
      rules = [];
      return;
    }
    try {
      const result = await sidecar.request<RulesResponse>(
        "eri/background/rules",
        { workspace: deps.workspaceRoot },
      );
      rules = result.rules ?? [];
    } catch (err) {
      rules = [];
      console.warn("[eri] janitor rules load failed", err);
    }
  };

  // Initial load — fire-and-forget so activation isn't gated on the sidecar.
  void refresh();

  const fileSaveListener = vscode.workspace.onDidSaveTextDocument(
    async (doc) => {
      if (rules.length === 0) return;
      const relpath = vscode.workspace.asRelativePath(doc.uri);
      for (const rule of rules) {
        if (!matchesSaveGlob(rule.on, relpath)) continue;
        const now = Date.now();
        const last = lastFired.get(rule.id) ?? 0;
        if (now - last < DEBOUNCE_MS) continue;
        lastFired.set(rule.id, now);
        await dispatchRuleCommand(rule);
      }
    },
  );
  context.subscriptions.push(fileSaveListener);

  // Re-read the file when the user changes `.eri/janitor.json` or
  // toggles the enabled setting.
  const fileWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(deps.workspaceRoot, ".eri/janitor.json"),
  );
  fileWatcher.onDidChange(() => void refresh());
  fileWatcher.onDidCreate(() => void refresh());
  fileWatcher.onDidDelete(() => void refresh());
  context.subscriptions.push(fileWatcher);

  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("eri.background.rulesEnabled")) {
      void refresh();
    }
  });
  context.subscriptions.push(configListener);

  return {
    dispose: (): void => {
      fileSaveListener.dispose();
      fileWatcher.dispose();
      configListener.dispose();
    },
  };
}

// Glob matcher lives in `./saveGlob` so it can be unit-tested
// without pulling the `vscode` module.

async function dispatchRuleCommand(rule: ParsedRule): Promise<void> {
  // `run` is either a slash command (`/test --path=tests/db`) or a
  // VS Code command id. We map slash → known eri commands; anything
  // else we hand to executeCommand verbatim.
  if (rule.run.startsWith("/")) {
    const [head, ...rest] = rule.run.slice(1).split(/\s+/);
    const args = rest.join(" ");
    const mapped = mapSlashToCommand(head);
    if (!mapped) {
      console.warn(`[eri] janitor rule ${rule.id}: unknown slash command ${head}`);
      return;
    }
    try {
      await vscode.commands.executeCommand(mapped, args);
    } catch (err) {
      console.warn(`[eri] janitor rule ${rule.id} dispatch failed`, err);
    }
    return;
  }
  try {
    await vscode.commands.executeCommand(rule.run);
  } catch (err) {
    console.warn(`[eri] janitor rule ${rule.id} dispatch failed`, err);
  }
}

function mapSlashToCommand(head: string): string | null {
  switch (head) {
    case "test":
      return "eri.composer.runSlash";
    case "ship":
      return "eri.ship.run";
    case "refactor":
      return "eri.composer.runSlash";
    case "explain":
      return "eri.composer.runSlash";
    default:
      return null;
  }
}
