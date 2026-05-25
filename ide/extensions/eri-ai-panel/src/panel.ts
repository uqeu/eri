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
    // Local handlers — intercept agent picker requests so the extension
    // host shows a QuickPick rather than forwarding to the sidecar.
    if (message.method === "eri/agents/openPicker") {
      void vscode.commands.executeCommand("eri.agents.switch");
      return;
    }
    if (message.method === "eri/ship/runFromPanel") {
      // The Ship button on the panel surfaces the same input flow as the
      // palette command — let the ship module own UX (input box, free-tier
      // upgrade modal, withProgress notification).
      void vscode.commands.executeCommand("eri.ship.run");
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
  .agent-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--eri-accent);
    display: inline-block;
  }
  .agent-dot.proxy { background: #228df2; }
  .agent-dot.cli { background: #34d399; }
  .agent-dot.byok { background: #facc15; }
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
<div class="model-pill" id="model-pill" title="Click to switch agent"><span class="agent-dot" id="agent-dot"></span><span id="agent-label">eri Engine</span></div>

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

<div class="section" id="ship-section" style="display: none;">
  <div class="section-label">Ship — Builder / Checker</div>
  <div id="ship-builders" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;"></div>
  <div id="ship-checker" style="border-top: 1px solid var(--border); padding-top: 8px;"></div>
  <div id="ship-totals" style="font-size: 11px; color: var(--muted); margin-top: 6px;"></div>
</div>

<div class="actions">
  <button class="action primary" id="btn-accept">Accept</button>
  <button class="action" id="btn-reject">Reject</button>
  <button class="action" id="btn-ship" title="Ship to frontier models">🚀 Ship</button>
</div>

<script>
const vscode = acquireVsCodeApi();
function send(method, params) { vscode.postMessage({ method: method, params: params || {} }); }
document.getElementById('btn-accept').addEventListener('click', () => send('eri/iteration/accept'));
document.getElementById('btn-reject').addEventListener('click', () => send('eri/iteration/reject'));
document.getElementById('btn-ship').addEventListener('click', () => send('eri/ship/runFromPanel'));
document.getElementById('model-pill').addEventListener('click', () => send('eri/agents/openPicker'));
const agentLabelEl = document.getElementById('agent-label');
const agentDotEl = document.getElementById('agent-dot');
function setAgent(label, kind) {
  if (label) agentLabelEl.textContent = label;
  agentDotEl.className = 'agent-dot ' + (kind || '');
}

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

const shipSectionEl = document.getElementById('ship-section');
const shipBuildersEl = document.getElementById('ship-builders');
const shipCheckerEl = document.getElementById('ship-checker');
const shipTotalsEl = document.getElementById('ship-totals');

function renderShip(state) {
  if (!state) { shipSectionEl.style.display = 'none'; return; }
  shipSectionEl.style.display = 'block';
  shipBuildersEl.textContent = '';
  for (const b of (state.builders || [])) {
    const row = document.createElement('div');
    row.style.padding = '6px';
    row.style.border = '1px solid var(--border)';
    row.style.borderRadius = '4px';
    row.style.fontSize = '11px';
    const label = document.createElement('div');
    label.textContent = b.model;
    label.style.fontWeight = '500';
    const status = document.createElement('div');
    status.style.color = 'var(--muted)';
    if (b.status === 'pending')      status.textContent = '· waiting';
    else if (b.status === 'running') status.textContent = '· building…';
    else if (b.status === 'done')    status.textContent = '✓ ' + ((b.tokensOut || 0) + ' tok out');
    else if (b.status === 'failed')  status.textContent = '⚠ ' + (b.reason || 'failed');
    row.appendChild(label);
    row.appendChild(status);
    shipBuildersEl.appendChild(row);
  }
  shipCheckerEl.textContent = '';
  const cLabel = document.createElement('div');
  cLabel.textContent = (state.checker && state.checker.model) || '';
  cLabel.style.fontSize = '11px';
  cLabel.style.fontWeight = '500';
  const cStatus = document.createElement('div');
  cStatus.style.fontSize = '11px';
  cStatus.style.color = 'var(--muted)';
  const c = state.checker || {};
  if (c.status === 'pending')      cStatus.textContent = '· waiting for builders';
  else if (c.status === 'running') cStatus.textContent = '· checking… (' + (c.tokensStreamed || 0) + ' tok streamed)';
  else if (c.status === 'done')    cStatus.textContent = '✓ merged ' + ((c.tokensOut || 0) + ' tok');
  else if (c.status === 'failed')  cStatus.textContent = '⚠ checker failed';
  shipCheckerEl.appendChild(cLabel);
  shipCheckerEl.appendChild(cStatus);
  if (state.totals) {
    shipTotalsEl.textContent = state.totals.tokensIn + ' in / ' + state.totals.tokensOut + ' out · ' +
      (state.totals.costMicros / 1000).toFixed(2) + 'm μ$';
  } else if (state.failureReason) {
    shipTotalsEl.textContent = '⚠ ' + state.failureReason;
  } else {
    shipTotalsEl.textContent = '';
  }
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
    case 'eri/agents/active':
      setAgent(params.label, params.kind);
      break;
    case 'eri/ship/progress':
      renderShip(params);
      break;
  }
});
</script>
</body>
</html>`;
  }
}
