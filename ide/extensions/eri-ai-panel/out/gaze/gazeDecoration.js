"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GazeDecoration = void 0;
const vscode = require("vscode");
// Accent matches the eri brand yellow used elsewhere in the panel UI.
// rgba expresses the 40% opacity request in a way VSCode's decoration API understands.
const ACCENT_RGBA = "rgba(224, 255, 79, 0.4)";
class GazeDecoration {
    decorationType;
    currentLine = null;
    currentEditorUri = null;
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
    showLine(line) {
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
    clear() {
        for (const editor of vscode.window.visibleTextEditors) {
            editor.setDecorations(this.decorationType, []);
        }
        this.currentLine = null;
        this.currentEditorUri = null;
    }
    // Called when the active editor changes — reapply the highlight if the same
    // document scrolled back into view, otherwise drop it so we don't smear an
    // accent across an unrelated buffer.
    refreshForActiveEditor() {
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
    dispose() {
        this.decorationType.dispose();
    }
    isEnabled() {
        return vscode.workspace
            .getConfiguration("eri.gaze")
            .get("decorationsEnabled", true);
    }
}
exports.GazeDecoration = GazeDecoration;
//# sourceMappingURL=gazeDecoration.js.map