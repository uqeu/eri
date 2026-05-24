// Entry point for the eri MCP preset starter pack.
// Registers the browse view, the four commands, and the SecretsStore used to
// hold MCP env-var API keys. Wired from extension.ts during activation.

import * as vscode from "vscode";
import { McpPresetsBrowseView, PRESETS_VIEW_ID } from "./browseView";
import { offerSafeDefaults, pickAndInstall } from "./flow";
import { McpSecretsStore } from "./secrets";

export interface McpPresetsHandle {
  readonly secrets: McpSecretsStore;
  readonly dispose: () => void;
}

export function activateMcpPresets(
  context: vscode.ExtensionContext,
): McpPresetsHandle {
  const secrets = new McpSecretsStore(context.secrets, context.globalState);
  const view = new McpPresetsBrowseView(context, secrets);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PRESETS_VIEW_ID, view),
  );

  const browseCommand = vscode.commands.registerCommand(
    "eri.mcpPresets.browse",
    async () => {
      await vscode.commands.executeCommand(
        "workbench.view.extension.eri-activitybar",
      );
      await vscode.commands.executeCommand(`${PRESETS_VIEW_ID}.focus`);
      await view.refresh();
    },
  );

  const installCommand = vscode.commands.registerCommand(
    "eri.mcpPresets.install",
    async () => {
      const includeBeta =
        vscode.workspace
          .getConfiguration("eri")
          .get<boolean>("mcpPresets.includeBeta") ?? false;
      await pickAndInstall(
        {
          secrets,
          onChange: () => {
            void view.refresh();
          },
        },
        { includeBeta },
      );
    },
  );

  const recommendedCommand = vscode.commands.registerCommand(
    "eri.mcpPresets.installRecommended",
    async () => {
      await offerSafeDefaults({
        secrets,
        onChange: () => {
          void view.refresh();
        },
      });
    },
  );

  const refreshCommand = vscode.commands.registerCommand(
    "eri.mcpPresets.refresh",
    async () => {
      await view.refresh();
    },
  );

  context.subscriptions.push(
    browseCommand,
    installCommand,
    recommendedCommand,
    refreshCommand,
  );

  return {
    secrets,
    dispose: () => {
      // Commands and view providers are disposed via context.subscriptions.
    },
  };
}
