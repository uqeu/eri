import * as vscode from "vscode";
import { Sidecar } from "../sidecar";

/**
 * Slash command registry. Slash commands are **agent intents** — distinct
 * from VS Code commands. They share three traits:
 *
 *   1. Always start with `/` in the chat composer.
 *   2. Each one maps to either a client-side dispatch (an existing
 *      `vscode.commands.executeCommand` or `sidecar.notify`) OR a
 *      server-side dispatch via `eri/slash/run`.
 *   3. They're listed once in `SLASH_COMMANDS` below — the source of
 *      truth for autocomplete, Cmd-K palette entries, and the picker.
 */

export type SlashDispatch =
  | { kind: "command"; command: string; argument?: (args: string) => unknown }
  | { kind: "sidecarSlash" } // → sidecar `eri/slash/run`
  | { kind: "stub"; reason: string };

export interface SlashCommand {
  readonly key: string; // matches `/<key>` in chat (lowercase, no slash)
  readonly label: string;
  readonly description: string;
  readonly placeholder?: string;
  readonly dispatch: SlashDispatch;
}

/**
 * The 15-command registry — the same list lives in
 * `crates/eri_coreutils/src/services/slash.rs` for the server-side stubs.
 * Keep in sync when adding/removing entries.
 */
export const SLASH_COMMANDS: ReadonlyArray<SlashCommand> = [
  {
    key: "ship",
    label: "/ship",
    description: "Builder/Checker tandem ship (Sonnet + GPT-4o + Gemini)",
    placeholder: "what to ship — e.g. refactor src/auth into stateless functions",
    dispatch: {
      kind: "command",
      command: "eri.ship.run",
      argument: (args) => args,
    },
  },
  {
    key: "plan",
    label: "/plan",
    description: "Multi-step plan with the Architect persona",
    placeholder: "goal to plan",
    dispatch: { kind: "sidecarSlash" }, // routed via iterate w/ architect persona client-side
  },
  {
    key: "execute",
    label: "/execute",
    description: "Run the last /plan step-by-step",
    dispatch: { kind: "stub", reason: "Plan execution autopilot — Phase 7b followup" },
  },
  {
    key: "test",
    label: "/test",
    description: "Generate tests with the Tester persona",
    placeholder: "path or current file",
    dispatch: { kind: "sidecarSlash" },
  },
  {
    key: "refactor",
    label: "/refactor",
    description: "Refactor with the Architect persona",
    placeholder: "scope",
    dispatch: { kind: "sidecarSlash" },
  },
  {
    key: "explain",
    label: "/explain",
    description: "Voice-friendly explanation of the current selection",
    dispatch: { kind: "sidecarSlash" },
  },
  {
    key: "recall",
    label: "/recall",
    description: "Search remembered patterns (Phase 8)",
    placeholder: "query",
    dispatch: { kind: "sidecarSlash" },
  },
  {
    key: "remember",
    label: "/remember",
    description: "Pin an explicit memory (Phase 8)",
    placeholder: "fact to remember",
    dispatch: { kind: "sidecarSlash" },
  },
  {
    key: "forget",
    label: "/forget",
    description: "Drop memories (Phase 8)",
    placeholder: "id or 'all'",
    dispatch: { kind: "sidecarSlash" },
  },
  {
    key: "voice",
    label: "/voice",
    description: "Toggle voice capture",
    placeholder: "on | off",
    dispatch: {
      kind: "command",
      command: "eri.toggleMic",
    },
  },
  {
    key: "agent",
    label: "/agent",
    description: "Switch persona (coder, architect, debugger, tester, shipper, mercury, eri)",
    placeholder: "persona name",
    dispatch: { kind: "sidecarSlash" },
  },
  {
    key: "cost",
    label: "/cost",
    description: "Show this session's token spend (Phase 8)",
    dispatch: { kind: "sidecarSlash" },
  },
  {
    key: "quota",
    label: "/quota",
    description: "Show remaining tokens + reset time",
    dispatch: {
      kind: "command",
      command: "eri.account.showStatus",
    },
  },
  {
    key: "learn",
    label: "/learn",
    description: "Enter observation mode (Phase 8)",
    dispatch: { kind: "sidecarSlash" },
  },
  {
    key: "sketch",
    label: "/sketch",
    description: "Mercury-only fast UI mockup from text",
    placeholder: "what to sketch",
    dispatch: { kind: "sidecarSlash" },
  },
];

export interface SlashRegistryHandle extends vscode.Disposable {
  /**
   * Parse a chat input like `/ship refactor src/auth` and dispatch. Returns
   * true when the input matched a known slash command (even if the dispatch
   * itself failed; the registry logs failures but never throws to the chat).
   */
  tryDispatchFromChat(input: string): Promise<boolean>;
  /** Pick from the QuickPick UI; convenience for the Cmd-K palette. */
  showPicker(): Promise<void>;
}

export function activateSlashRegistry(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
): SlashRegistryHandle {
  const findByKey = (key: string): SlashCommand | undefined =>
    SLASH_COMMANDS.find((c) => c.key === key.toLowerCase());

  const dispatchSlash = async (
    cmd: SlashCommand,
    args: string,
  ): Promise<void> => {
    const trimmed = args.trim();
    switch (cmd.dispatch.kind) {
      case "command":
        await vscode.commands.executeCommand(
          cmd.dispatch.command,
          cmd.dispatch.argument ? cmd.dispatch.argument(trimmed) : trimmed,
        );
        return;
      case "sidecarSlash": {
        // Workspace-scoped slashes need a folder so `.eri/persona` lookups work.
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
          vscode.window.showWarningMessage(
            `/${cmd.key} needs an open workspace folder.`,
          );
          return;
        }
        const sidecar = getSidecar();
        if (!sidecar) {
          vscode.window.showErrorMessage("Sidecar not running — try again.");
          return;
        }
        try {
          const result = await sidecar.request<{
            ok?: boolean;
            error?: string;
            message?: string;
            persona?: string;
            phase?: string;
          }>("eri/slash/run", {
            command: cmd.key,
            args: trimmed,
            workspace: folder.uri.fsPath,
          });
          if (result.error === "dispatch_client") {
            // Server says: handle this client-side. For now we fall through
            // to a stub toast so the user knows the command was recognized
            // but the iterate-with-persona wiring is pending.
            vscode.window.showInformationMessage(
              `/${cmd.key} dispatch is client-side — wiring lands with the next pass.`,
            );
            return;
          }
          if (result.error === "not_implemented") {
            vscode.window.showInformationMessage(
              result.message ??
                `/${cmd.key} lands later (phase ${result.phase ?? "?"}).`,
            );
            return;
          }
          if (result.error === "unknown_persona" || result.error === "unknown_command") {
            vscode.window.showWarningMessage(result.message ?? `/${cmd.key} failed.`);
            return;
          }
          if (result.message) {
            vscode.window.showInformationMessage(result.message);
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`/${cmd.key} failed: ${msg}`);
        }
        return;
      }
      case "stub":
        vscode.window.showInformationMessage(
          `/${cmd.key}: ${cmd.dispatch.reason}`,
        );
        return;
    }
  };

  const tryDispatchFromChat = async (input: string): Promise<boolean> => {
    const trimmed = input.trimStart();
    if (!trimmed.startsWith("/")) {
      return false;
    }
    const space = trimmed.indexOf(" ");
    const key = (space === -1 ? trimmed.slice(1) : trimmed.slice(1, space)).toLowerCase();
    const args = space === -1 ? "" : trimmed.slice(space + 1);
    const cmd = findByKey(key);
    if (!cmd) {
      return false;
    }
    await dispatchSlash(cmd, args);
    return true;
  };

  const showPicker = async (): Promise<void> => {
    const items = SLASH_COMMANDS.map((c) => ({
      label: c.label,
      description: c.description,
      key: c.key,
    }));
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: "Pick a slash command",
      matchOnDescription: true,
    });
    if (!pick) {
      return;
    }
    const cmd = findByKey(pick.key);
    if (!cmd) {
      return;
    }
    let args = "";
    if (cmd.placeholder) {
      const input = await vscode.window.showInputBox({
        prompt: cmd.label,
        placeHolder: cmd.placeholder,
        ignoreFocusOut: true,
      });
      if (input === undefined) {
        return;
      }
      args = input;
    }
    await dispatchSlash(cmd, args);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("eri.slash.pick", showPicker),
    vscode.commands.registerCommand(
      "eri.slash.run",
      async (input: unknown) => {
        if (typeof input === "string" && input.length > 0) {
          const matched = await tryDispatchFromChat(input);
          if (!matched) {
            vscode.window.showWarningMessage(`Unknown slash command: ${input}`);
          }
          return;
        }
        await showPicker();
      },
    ),
  );

  // Per-command palette entries: `eri.slash.ship`, `eri.slash.plan`, etc.
  for (const cmd of SLASH_COMMANDS) {
    const id = `eri.slash.${cmd.key}`;
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async () => {
        let args = "";
        if (cmd.placeholder) {
          const input = await vscode.window.showInputBox({
            prompt: cmd.label,
            placeHolder: cmd.placeholder,
            ignoreFocusOut: true,
          });
          if (input === undefined) {
            return;
          }
          args = input;
        }
        await dispatchSlash(cmd, args);
      }),
    );
  }

  return {
    tryDispatchFromChat,
    showPicker,
    dispose: () => {
      // Commands are disposed via context.subscriptions.
    },
  };
}
