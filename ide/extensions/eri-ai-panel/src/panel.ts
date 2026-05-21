import * as vscode from "vscode";
import { Sidecar, SidecarNotification } from "./sidecar";

export class EriPanelProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getSidecar: () => Sidecar | null,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    view.webview.html = this.renderHtml();
    view.webview.onDidReceiveMessage((message) => this.handleMessage(message));
  }

  postToWebview(notification: SidecarNotification): void {
    this.view?.webview.postMessage(notification);
  }

  private handleMessage(message: { method?: string; params?: unknown }): void {
    if (!message.method) {
      return;
    }
    this.getSidecar()?.notify(message.method, message.params ?? {});
  }

  private renderHtml(): string {
    // Self-contained webview HTML. All dynamic content from sidecar notifications
    // is inserted via textContent (see addIterationRow in the inline script),
    // not template strings, so there is no untrusted HTML injection.
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>eri</title>
<style>
  :root {
    color-scheme: dark;
    --bg: var(--vscode-editor-background, #181818);
    --fg: var(--vscode-editor-foreground, #d6d6dd);
    --muted: #8b8b96;
    --border: #292929;
    --accent: #228df2;
    --eri-accent: #e0ff4f;
    --card: #212121;
  }
  body {
    margin: 0;
    padding: 16px;
    font-family: var(--vscode-font-family);
    font-size: 13px;
    line-height: 1.55;
    background: var(--bg);
    color: var(--fg);
  }
  .model-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 10px;
    border-radius: 9999px;
    background: var(--card);
    border: 1px solid var(--border);
    font-size: 12px;
    cursor: pointer;
  }
  .model-pill::after { content: "▾"; opacity: 0.6; }
  .section { margin-top: 16px; }
  .section-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin-bottom: 8px;
  }
  .mic-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--card);
  }
  .mic-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
  }
  .mic-dot.active { background: var(--eri-accent); box-shadow: 0 0 8px var(--eri-accent); }
  .transcript {
    min-height: 24px;
    color: var(--fg);
    font-style: italic;
    opacity: 0.85;
  }
  .iteration {
    display: flex;
    flex-direction: column;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid transparent;
    cursor: pointer;
  }
  .iteration:hover { background: var(--card); border-color: var(--border); }
  .iteration .meta { font-size: 11px; color: var(--muted); }
  .actions { display: flex; gap: 8px; margin-top: 16px; }
  button.action {
    flex: 1;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--fg);
    font-family: var(--vscode-font-family);
    cursor: pointer;
  }
  button.action.primary { background: var(--accent); border-color: var(--accent); color: white; }
  .progress { height: 4px; background: var(--card); border-radius: 4px; overflow: hidden; }
  .progress .bar { height: 100%; background: var(--eri-accent); width: 0%; transition: width 120ms linear; }
</style>
</head>
<body>
<div class="model-pill" id="model-pill">eri Engine</div>

<div class="section">
  <div class="section-label">Voice</div>
  <div class="mic-row">
    <div class="mic-dot" id="mic-dot"></div>
    <div class="transcript" id="transcript">push Cmd-L to talk</div>
  </div>
</div>

<div class="section">
  <div class="section-label">Iterations</div>
  <div id="iterations"></div>
</div>

<div class="section">
  <div class="section-label">Diffusion</div>
  <div class="progress"><div class="bar" id="bar"></div></div>
  <div style="font-size: 11px; color: var(--muted); margin-top: 6px;" id="stream-meta">idle</div>
</div>

<div class="actions">
  <button class="action primary" id="btn-accept">Accept</button>
  <button class="action" id="btn-reject">Reject</button>
</div>

<script>
const vscode = acquireVsCodeApi();
function send(method, params) { vscode.postMessage({ method: method, params: params || {} }); }
document.getElementById('btn-accept').addEventListener('click', () => send('eri/iteration/accept'));
document.getElementById('btn-reject').addEventListener('click', () => send('eri/iteration/reject'));

const iterationsEl = document.getElementById('iterations');
const transcriptEl = document.getElementById('transcript');
const micDotEl = document.getElementById('mic-dot');
const barEl = document.getElementById('bar');
const streamMetaEl = document.getElementById('stream-meta');

function addIterationRow(label, stage) {
  const row = document.createElement('div');
  row.className = 'iteration';
  const labelEl = document.createElement('div');
  labelEl.textContent = label || 'iteration';
  const metaEl = document.createElement('div');
  metaEl.className = 'meta';
  metaEl.textContent = (stage || '') + ' · just now';
  row.appendChild(labelEl);
  row.appendChild(metaEl);
  iterationsEl.prepend(row);
}

window.addEventListener('message', (event) => {
  const method = event.data && event.data.method;
  const params = (event.data && event.data.params) || {};
  switch (method) {
    case 'eri/voice/partial':
    case 'eri/voice/final':
      transcriptEl.textContent = params.text || '';
      micDotEl.classList.toggle('active', method === 'eri/voice/partial');
      break;
    case 'eri/inference/delta':
      barEl.style.width = (params.progress || 0) + '%';
      streamMetaEl.textContent = (params.bytes || 0) + 'B · ' + (params.elapsed_ms || 0) + 'ms';
      break;
    case 'eri/iteration/recorded':
      addIterationRow(params.label, params.stage);
      break;
  }
});
</script>
</body>
</html>`;
  }
}
