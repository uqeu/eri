import * as vscode from "vscode";

import { GazePoint, GazeService } from "./gazeService";

const FADE_MS = 1500;
const UPDATE_INTERVAL_MS = 80;
const ACCENT_RGBA = "rgba(224, 255, 79, 0.18)";

/// Subtle line-level decoration that follows the user's gaze on the
/// active editor. Throttled to ~12Hz and only repainted when the
/// inferred line changes — never on every sample.
export class EditorGaze implements vscode.Disposable {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private currentLine: number | null = null;
  private lastUpdateMs = 0;
  private fadeTimer: NodeJS.Timeout | null = null;
  private readonly subs: vscode.Disposable[] = [];

  constructor(private readonly service: GazeService) {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: ACCENT_RGBA,
      overviewRulerColor: ACCENT_RGBA,
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    this.subs.push(
      this.service.onGaze((point) => this.handlePoint(point)),
      vscode.window.onDidChangeActiveTextEditor(() => this.clear()),
    );
  }

  private isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("eri.gaze")
      .get<boolean>("editorHighlight", true);
  }

  private handlePoint(point: GazePoint): void {
    if (!this.isEnabled()) {
      this.clear();
      return;
    }
    const now = Date.now();
    if (now - this.lastUpdateMs < UPDATE_INTERVAL_MS) {
      return;
    }
    this.lastUpdateMs = now;

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    // Only highlight when the user is plausibly looking at the editor
    // pane — coarse heuristic: middle horizontal band.
    if (point.x < 0.18 || point.x > 0.82 || point.y > 0.7) {
      return;
    }
    const visible = editor.visibleRanges[0];
    if (!visible) {
      return;
    }
    const span = visible.end.line - visible.start.line;
    if (span <= 0) {
      return;
    }
    // y is normalised to the whole screen; we map the editor band
    // (0.05..0.7) onto the visible range.
    const normalized = Math.max(0, Math.min(1, (point.y - 0.05) / (0.7 - 0.05)));
    const line = Math.min(
      visible.end.line,
      Math.max(visible.start.line, Math.floor(visible.start.line + normalized * span)),
    );
    if (line === this.currentLine) {
      this.scheduleFade();
      return;
    }
    this.applyLine(editor, line);
  }

  private applyLine(editor: vscode.TextEditor, line: number): void {
    const range = editor.document.lineAt(line).range;
    editor.setDecorations(this.decorationType, [range]);
    this.currentLine = line;
    this.scheduleFade();
  }

  private scheduleFade(): void {
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
    }
    this.fadeTimer = setTimeout(() => this.clear(), FADE_MS);
  }

  clear(): void {
    if (this.currentLine === null) {
      return;
    }
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.decorationType, []);
    }
    this.currentLine = null;
  }

  dispose(): void {
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    this.decorationType.dispose();
    for (const sub of this.subs) {
      sub.dispose();
    }
    this.subs.length = 0;
  }
}

/// Map a normalised y coordinate onto a line within a visible range.
/// Extracted so tests can exercise the inference without spinning up a
/// real editor.
export function inferEditorLine(
  y: number,
  visibleStart: number,
  visibleEnd: number,
  yMin = 0.05,
  yMax = 0.7,
): number {
  const span = visibleEnd - visibleStart;
  if (span <= 0) {
    return visibleStart;
  }
  const normalized = Math.max(0, Math.min(1, (y - yMin) / (yMax - yMin)));
  return Math.min(visibleEnd, Math.max(visibleStart, Math.floor(visibleStart + normalized * span)));
}
