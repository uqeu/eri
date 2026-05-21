import * as vscode from "vscode";
import { AtMentionsHandle } from "../at_mentions";
import { Sidecar, SidecarNotification } from "../sidecar";
import { ComposerView } from "./composerView";

export interface ComposerHandle {
  open(): void;
  applyAll(): void;
  discard(): void;
  forward(notification: SidecarNotification): void;
}

const FORWARDED_METHODS: ReadonlySet<string> = new Set([
  "eri/composer/plan/result",
  "eri/composer/applied",
  "eri/composer/error",
  "eri/model/changed",
]);

export function activateComposer(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
  atMentions: AtMentionsHandle,
): ComposerHandle {
  const view = new ComposerView(context, getSidecar, atMentions);

  context.subscriptions.push({
    dispose: () => view.dispose(),
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("eri.composer.applyAll", () => {
      view.applyAll();
    }),
    vscode.commands.registerCommand("eri.composer.discard", () => {
      view.discard();
    }),
  );

  return {
    open: () => view.open(),
    applyAll: () => view.applyAll(),
    discard: () => view.discard(),
    forward: (notification) => {
      if (FORWARDED_METHODS.has(notification.method)) {
        view.postFromSidecar(notification);
      }
    },
  };
}
