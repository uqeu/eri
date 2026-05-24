// Bundles the visual editor's pending tweaks into a chat message that the
// agent can act on. Falls back to clipboard if the chat command isn't
// registered yet.

import * as vscode from "vscode";
import { PickedElement, describeElement } from "./pickerBridge";
import { TweakStore } from "./styleTweaker";

export interface ApplyOutcome {
  readonly sent: boolean;
  readonly via: "chat" | "clipboard";
  readonly heading: string;
  readonly body: string;
}

export async function applyTweaksToSource(
  element: PickedElement,
  store: TweakStore,
  options: { note?: string } = {},
): Promise<ApplyOutcome> {
  const { heading, body } = describeElement(element);
  const tweaks = store.toCssBody();
  const noteLine = options.note ? `\nuser note: ${options.note}\n` : "";
  const fullBody = [
    body,
    "",
    "requested style changes (apply to source):",
    tweaks.length > 0 ? tweaks : "  (no tweaks)",
    noteLine,
  ]
    .join("\n")
    .trimEnd();

  const finalHeading = `${heading} (visual edit)`;

  try {
    await vscode.commands.executeCommand("eri.chat.insertContext", {
      heading: finalHeading,
      body: fullBody,
    });
    return { sent: true, via: "chat", heading: finalHeading, body: fullBody };
  } catch {
    await vscode.env.clipboard.writeText(`${finalHeading}\n\n${fullBody}`);
    vscode.window.showInformationMessage(
      "eri Visual Editor - copied edit to clipboard (chat insert-context not available).",
    );
    return {
      sent: true,
      via: "clipboard",
      heading: finalHeading,
      body: fullBody,
    };
  }
}

// Send a free-form prompt to chat - used by multi-target voice intents like
// "make the buttons rounder" where there's no picked element.
export async function sendPromptToChat(prompt: string): Promise<"chat" | "clipboard"> {
  try {
    await vscode.commands.executeCommand("eri.chat.insertContext", {
      heading: "@VisualEditor",
      body: prompt,
    });
    return "chat";
  } catch {
    await vscode.env.clipboard.writeText(prompt);
    vscode.window.showInformationMessage(
      "eri Visual Editor - copied prompt to clipboard.",
    );
    return "clipboard";
  }
}
