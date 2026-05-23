import * as vscode from "vscode";
import { SettingsHubProvider } from "./hubProvider";

export interface SettingsHubHandle {
  readonly provider: SettingsHubProvider;
  dispose(): void;
}

export function activateSettingsHub(context: vscode.ExtensionContext): SettingsHubHandle {
  const provider = new SettingsHubProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SettingsHubProvider.viewType, provider),
    vscode.commands.registerCommand("eri.settings.hub", async () => {
      // Reveal the eri activity-bar container, then focus this view.
      await vscode.commands
        .executeCommand("workbench.view.extension.eri-activitybar")
        .then(undefined, () => undefined);
      await vscode.commands
        .executeCommand(`${SettingsHubProvider.viewType}.focus`)
        .then(undefined, () => undefined);
      provider.reveal();
    }),
  );

  const handle: SettingsHubHandle = {
    provider,
    dispose: () => provider.dispose(),
  };
  context.subscriptions.push({ dispose: () => handle.dispose() });
  return handle;
}

export { SettingsHubProvider };
