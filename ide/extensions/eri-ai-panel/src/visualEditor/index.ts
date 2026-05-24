// Activator for the Visual Editor feature. Wires the panel + commands and
// returns a handle the host extension can use to forward sidecar events.

import * as vscode from "vscode";
import { Sidecar, SidecarNotification } from "../sidecar";
import { GraphClient, currentWorkspaceFsPath } from "../graph/api";
import { VisualEditorPanel } from "./panel";
import { StyleChange } from "./pickerBridge";

export interface VisualEditorHandle {
  forward(notification: SidecarNotification): void;
  dispose(): void;
}

export function activateVisualEditor(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
): VisualEditorHandle {
  const graphClient = new GraphClient(getSidecar, currentWorkspaceFsPath);
  const panel = new VisualEditorPanel({
    context,
    sessionLogger: {
      async logChange(change: StyleChange): Promise<void> {
        try {
          await graphClient.insertNode(
            "visual_edit",
            {
              selector: change.selector,
              styles: change.styles,
              voiceTriggered: false,
              gazeTargeted: false,
            },
            ["visual-editor"],
          );
        } catch {
          // graph crate may not be wired yet; degrade silently.
        }
      },
    },
  });

  const disposables: vscode.Disposable[] = [
    vscode.commands.registerCommand("eri.visualEditor.open", () => panel.open()),
    vscode.commands.registerCommand("eri.visualEditor.setUrl", () => panel.setUrl()),
    vscode.commands.registerCommand("eri.visualEditor.pickElement", () => panel.pickElement()),
    vscode.commands.registerCommand("eri.visualEditor.applyToSource", () =>
      panel.applyAccumulated(),
    ),
  ];

  for (const d of disposables) {
    context.subscriptions.push(d);
  }

  return {
    forward(notification: SidecarNotification): void {
      panel.forwardSidecar(notification);
    },
    dispose(): void {
      for (const d of disposables) {
        d.dispose();
      }
      panel.dispose();
    },
  };
}
