import * as vscode from "vscode";

// Accent matches the eri brand yellow used elsewhere in the panel UI.
// rgba expresses the 40% opacity request in a way VSCode's decoration API understands.
const ACCENT_RGBA = "rgba(224, 255, 79, 0.4)";

export class GazeDecoration implements vscode.Disposable {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private currentLine: number | null = null;
  private currentEditorUri: string | null = null;

  constructor() {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      borderWidth: "0 0 0 2px",
      borderStyle: "solid",
      borderColor: ACCENT_RGBA,
      // overviewRulerLane gives a small minimap hint so the user sees the gaze
      // position even when scrolled away from the active line.
      overviewRulerColor: ACCENT_RGBA,
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
  }

  showLine(line: number): void {
    if (!this.isEnabled()) {
      this.clear();
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this.currentLine = line;
      this.currentEditorUri = null;
      return;
    }
    const lineCount = editor.document.lineCount;
    if (line < 0 || line >= lineCount) {
      this.clear();
      return;
    }
    const range = editor.document.lineAt(line).range;
    editor.setDecorations(this.decorationType, [range]);
    this.currentLine = line;
    this.currentEditorUri = editor.document.uri.toString();
  }

  clear(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.decorationType, []);
    }
    this.currentLine = null;
    this.currentEditorUri = null;
  }

  // Called when the active editor changes — reapply the highlight if the same
  // document scrolled back into view, otherwise drop it so we don't smear an
  // accent across an unrelated buffer.
  refreshForActiveEditor(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || this.currentLine === null) {
      return;
    }
    if (this.currentEditorUri && this.currentEditorUri !== editor.document.uri.toString()) {
      this.clear();
      return;
    }
    this.showLine(this.currentLine);
  }

  dispose(): void {
    this.decorationType.dispose();
  }

  private isEnabled(): boolean {
    return vscode.workspace
      .getConfiguration("eri.gaze")
      .get<boolean>("decorationsEnabled", true);
  }
}
