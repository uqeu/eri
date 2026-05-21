import * as path from "path";
import * as vscode from "vscode";

export class PreviewManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;
  private watcher: vscode.FileSystemWatcher | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  open(sessionPath?: string): void {
    const target = sessionPath ?? this.detectActiveSession();
    if (!target) {
      vscode.window.showInformationMessage("eri: no active iteration session");
      return;
    }

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "eri.preview",
        "eri · preview",
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            this.context.extensionUri,
            vscode.Uri.file(target),
          ],
        },
      );
      this.panel.onDidDispose(() => {
        this.panel = null;
        this.watcher?.dispose();
        this.watcher = null;
      });
    }

    this.panel.webview.html = this.renderHtml(target);
    this.attachWatcher(target);
    this.panel.reveal(vscode.ViewColumn.Beside, true);
  }

  dispose(): void {
    this.panel?.dispose();
    this.watcher?.dispose();
  }

  private detectActiveSession(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return null;
    }
    return path.join(folders[0].uri.fsPath, ".eri", "sessions", "current");
  }

  private attachWatcher(sessionPath: string): void {
    this.watcher?.dispose();
    const pattern = new vscode.RelativePattern(sessionPath, "index.html");
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const reload = () => this.panel?.webview.postMessage({ method: "reload" });
    this.watcher.onDidCreate(reload);
    this.watcher.onDidChange(reload);
  }

  private renderHtml(sessionPath: string): string {
    if (!this.panel) {
      return "";
    }
    const indexUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(path.join(sessionPath, "index.html")),
    );
    const cspSource = this.panel.webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; frame-src ${cspSource} https:; style-src 'unsafe-inline' ${cspSource}; script-src 'unsafe-inline';">
<title>eri · preview</title>
<style>
  body { margin: 0; background: #0a0a0a; color: #d6d6dd; font-family: var(--vscode-font-family); display: flex; flex-direction: column; height: 100vh; }
  .toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid #292929; font-size: 12px; }
  .toolbar .dot { width: 8px; height: 8px; border-radius: 50%; background: #e0ff4f; }
  .toolbar .url { flex: 1; opacity: 0.6; font-family: var(--vscode-editor-font-family); }
  .toolbar button { background: transparent; color: inherit; border: 1px solid #292929; border-radius: 4px; padding: 2px 8px; cursor: pointer; }
  iframe { flex: 1; border: none; background: white; }
</style>
</head>
<body>
<div class="toolbar">
  <div class="dot"></div>
  <div class="url">${indexUri.toString()}</div>
  <button onclick="document.getElementById('frame').src = document.getElementById('frame').src">↻</button>
</div>
<iframe id="frame" src="${indexUri.toString()}" sandbox="allow-scripts allow-same-origin"></iframe>
<script>
window.addEventListener('message', (event) => {
  if (event.data?.method === 'reload') {
    const f = document.getElementById('frame');
    f.src = f.src.split('#')[0] + '#' + Date.now();
  }
});
</script>
</body>
</html>`;
  }
}
