import * as vscode from "vscode";
import { PreviewSurfaceCoordinator } from "../preview/surfaceCoordinator";
import { Sidecar } from "../sidecar";
import { matchViewIntent, ViewIntent, NavigateIntent } from "./viewIntents";

export interface ViewIntentDispatcherDeps {
  readonly previewCoordinator: PreviewSurfaceCoordinator | null;
  readonly getSidecar: () => Sidecar | null;
}

/**
 * Try to handle a transcript as a view intent (zoom / scroll / navigate).
 * Returns `true` when the intent was claimed so the caller can skip
 * terminal-intent routing for the same transcript.
 *
 * Routing rules:
 *   - zoom in editor → workbench.action.zoomIn / Out (font size step)
 *   - zoom in preview → relay through the preview surface coordinator
 *   - scroll → editor.action.scrollLineDown etc. when editor focused,
 *              preview gaze relay otherwise
 *   - navigate → file find → workspace symbol → preview selector hint
 *                → Quick Pick fallback
 */
export async function tryDispatchViewIntent(
  transcript: string,
  deps: ViewIntentDispatcherDeps,
): Promise<boolean> {
  const intent = matchViewIntent(transcript);
  if (!intent) return false;
  switch (intent.kind) {
    case "zoom":
      await handleZoom(intent.direction, intent.magnitude, deps);
      return true;
    case "scroll":
      await handleScroll(intent.direction, intent.magnitude, deps);
      return true;
    case "navigate":
      await handleNavigate(intent, deps);
      return true;
  }
}

async function handleZoom(
  direction: "in" | "out",
  magnitude: "small" | "big",
  deps: ViewIntentDispatcherDeps,
): Promise<void> {
  const steps = magnitude === "big" ? 3 : 1;
  const editorFocused = isEditorFocused();
  if (editorFocused) {
    const cmd = direction === "in" ? "editor.action.fontZoomIn" : "editor.action.fontZoomOut";
    for (let i = 0; i < steps; i += 1) {
      await vscode.commands.executeCommand(cmd);
    }
    return;
  }
  // Otherwise zoom the preview surface — best-effort relay.
  // The Swift binary listens for `zoom` over its socket; the embedded
  // webview ignores zoom messages (browser pinch-zoom isn't programmable
  // from extension code). Honest about which surface handles it.
  const sidecar = deps.getSidecar();
  if (sidecar && deps.previewCoordinator?.active() === "swift") {
    sidecar.notify("eri/preview/zoom", { direction, magnitude });
  } else {
    // Fall back to workbench font zoom so the command isn't silently ignored.
    const cmd = direction === "in" ? "workbench.action.zoomIn" : "workbench.action.zoomOut";
    for (let i = 0; i < steps; i += 1) {
      await vscode.commands.executeCommand(cmd);
    }
  }
}

async function handleScroll(
  direction: "up" | "down" | "left" | "right",
  magnitude: "small" | "big",
  deps: ViewIntentDispatcherDeps,
): Promise<void> {
  if (isEditorFocused()) {
    const cmd = scrollCommandForEditor(direction, magnitude);
    if (cmd) {
      await vscode.commands.executeCommand(cmd);
    }
    return;
  }
  const sidecar = deps.getSidecar();
  if (sidecar && deps.previewCoordinator?.active() === "swift") {
    sidecar.notify("eri/preview/scroll", { direction, magnitude });
  }
}

function scrollCommandForEditor(
  direction: "up" | "down" | "left" | "right",
  magnitude: "small" | "big",
): string | null {
  if (direction === "left" || direction === "right") {
    // VS Code doesn't have a "scroll left/right by N" — caret movement
    // is the closest analog, and we only fire it for editor focus.
    return direction === "left" ? "cursorLeft" : "cursorRight";
  }
  if (magnitude === "big") {
    return direction === "down" ? "editor.action.scrollPageDown" : "editor.action.scrollPageUp";
  }
  return direction === "down" ? "editor.action.scrollLineDown" : "editor.action.scrollLineUp";
}

async function handleNavigate(
  intent: NavigateIntent,
  _deps: ViewIntentDispatcherDeps,
): Promise<void> {
  const target = intent.target;
  // 1. File match — accept anything containing a dot or slash, or any
  //    workspace file whose basename matches case-insensitively.
  const fileTarget = await resolveFileTarget(target);
  if (fileTarget) {
    const doc = await vscode.workspace.openTextDocument(fileTarget);
    await vscode.window.showTextDocument(doc, { preview: true });
    return;
  }
  // 2. Workspace symbol resolution.
  const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
    "vscode.executeWorkspaceSymbolProvider",
    target,
  );
  const symbol = (symbols ?? [])[0];
  if (symbol) {
    const doc = await vscode.workspace.openTextDocument(symbol.location.uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: true });
    editor.revealRange(symbol.location.range, vscode.TextEditorRevealType.InCenter);
    editor.selection = new vscode.Selection(symbol.location.range.start, symbol.location.range.end);
    return;
  }
  // 3. Fallback: open Quick Pick prefilled with the target text so the
  //    user can scrub to whatever they meant.
  await vscode.commands.executeCommand("workbench.action.quickOpen", target);
}

async function resolveFileTarget(target: string): Promise<vscode.Uri | null> {
  // Looks like a path? Try as a glob first.
  if (/[./]/.test(target)) {
    const matches = await vscode.workspace.findFiles(`**/${target}`, "**/node_modules/**", 5);
    if (matches.length > 0) return matches[0];
  }
  // Otherwise treat the whole target as a basename match.
  const basenameGlob = `**/${target.split(/\s+/).join("-").toLowerCase()}*`;
  const fuzzy = await vscode.workspace.findFiles(basenameGlob, "**/node_modules/**", 1);
  return fuzzy[0] ?? null;
}

function isEditorFocused(): boolean {
  // Heuristic: there is an active text editor and the panel/terminal
  // isn't in the foreground. Voice intents that don't get an editor
  // focus signal fall through to the preview surface.
  return vscode.window.activeTextEditor !== undefined;
}

export { ViewIntent };
