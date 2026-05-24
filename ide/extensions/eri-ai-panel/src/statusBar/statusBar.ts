import * as vscode from "vscode";

/**
 * eri status bar handle — owns the primary "eri" indicator and updates its
 * label/tint based on the current runtime state (idle, listening, thinking,
 * gazing). Positioned LEFT with high priority so it sits to the left of the
 * default workbench items (language mode, indentation, encoding, etc.).
 */
export interface EriStatusBarHandle {
  readonly item: vscode.StatusBarItem;
  setState(state: EriStatusBarState): void;
  dispose(): void;
}

export type EriStatusBarState =
  | { kind: "idle" }
  | { kind: "listening" }
  | { kind: "thinking" }
  | { kind: "gazing"; line?: number }
  | { kind: "error"; message: string };

const ACCENT_YELLOW = "#F5E867";
const MUTED = "#9AA4AD";
const ERROR_RED = "#EF4444";

function renderLabel(state: EriStatusBarState): { text: string; tooltip: string; color?: string } {
  switch (state.kind) {
    case "listening":
      return {
        text: "$(mic) eri ● listening",
        tooltip: "eri is listening for voice input",
        color: ACCENT_YELLOW,
      };
    case "thinking":
      return {
        text: "$(sync~spin) eri ● thinking",
        tooltip: "eri is generating a response",
        color: ACCENT_YELLOW,
      };
    case "gazing":
      return {
        text: state.line !== undefined
          ? `$(eye) eri ● gaze L${state.line}`
          : "$(eye) eri ● gaze active",
        tooltip: "Gaze tracking is active",
        color: ACCENT_YELLOW,
      };
    case "error":
      return {
        text: `$(error) eri ● ${state.message}`,
        tooltip: `eri error: ${state.message}`,
        color: ERROR_RED,
      };
    case "idle":
    default:
      return {
        text: "$(sparkle) eri ● ready",
        tooltip: "eri is ready. Click to open chat (Cmd+L).",
        color: ACCENT_YELLOW,
      };
  }
}

/**
 * Activate the eri status bar item. Returns an immutable handle; callers
 * push new state via setState (no in-place mutation of state objects).
 */
export function activateStatusBar(context: vscode.ExtensionContext): EriStatusBarHandle {
  // Priority chosen high so we sit LEFT of language-mode/encoding/etc.
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    1000,
  );
  item.name = "eri";
  item.command = "eri.openChat";

  let current: EriStatusBarState = { kind: "idle" };

  const apply = (state: EriStatusBarState): void => {
    const { text, tooltip, color } = renderLabel(state);
    item.text = text;
    item.tooltip = tooltip;
    item.color = color ?? MUTED;
  };

  apply(current);
  item.show();
  context.subscriptions.push(item);

  return {
    item,
    setState(state: EriStatusBarState): void {
      // Create a new state reference rather than mutating the prior one.
      current = state;
      apply(current);
    },
    dispose(): void {
      item.dispose();
    },
  };
}
