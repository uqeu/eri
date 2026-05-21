import * as vscode from "vscode";
import { AT_MENTION_KINDS, AtMentionKind, AtMentionRegistry } from "./registry";

interface SettingsMessage {
  method?: string;
  params?: { kind?: string; enabled?: boolean };
}

const VIEW_TYPE = "eri.atMentions.settings";

// Lightweight webview for toggling each of the 11 mention kinds on or off.
export class AtMentionSettingsView {
  private panel: vscode.WebviewPanel | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly registry: AtMentionRegistry,
  ) {}

  open(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      this.postState();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      "eri · @-mentions",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.extensionUri],
      },
    );
    this.panel.webview.html = renderHtml();
    this.panel.webview.onDidReceiveMessage((message: SettingsMessage) =>
      this.handleMessage(message),
    );
    this.panel.onDidDispose(() => {
      this.panel = null;
    });
    this.postState();
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
  }

  private async handleMessage(message: SettingsMessage): Promise<void> {
    if (message.method !== "eri/atMentions/toggle") {
      return;
    }
    const params = message.params ?? {};
    const kind = params.kind;
    const enabled = params.enabled;
    if (typeof kind !== "string" || typeof enabled !== "boolean") {
      return;
    }
    if (!AT_MENTION_KINDS.some((descriptor) => descriptor.id === kind)) {
      return;
    }
    await this.registry.setEnabled(kind as AtMentionKind, enabled);
    this.postState();
  }

  private postState(): void {
    if (!this.panel) {
      return;
    }
    this.panel.webview.postMessage({
      method: "eri/atMentions/state",
      params: {
        kinds: AT_MENTION_KINDS.map((descriptor) => ({
          id: descriptor.id,
          token: descriptor.token,
          description: descriptor.description,
          enabled: this.registry.isEnabled(descriptor.id),
        })),
      },
    });
  }
}

function renderHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>eri @-mentions</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #181818;
    --fg: #d6d6dd;
    --muted: #8b8b96;
    --border: #292929;
    --card: #212121;
    --accent: #e0ff4f;
  }
  body {
    margin: 0;
    padding: 18px;
    font-family: var(--vscode-font-family);
    color: var(--fg);
    background: var(--bg);
  }
  h1 { font-size: 16px; margin: 0 0 6px; }
  .subtitle { color: var(--muted); font-size: 12px; margin-bottom: 18px; }
  ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
  li {
    display: flex;
    align-items: center;
    gap: 12px;
    border: 1px solid var(--border);
    background: var(--card);
    border-radius: 8px;
    padding: 10px 12px;
  }
  .token { font-family: var(--vscode-editor-font-family, monospace); color: var(--accent); font-weight: 600; }
  .desc { color: var(--muted); font-size: 12px; flex: 1; }
  .toggle {
    width: 36px;
    height: 20px;
    border-radius: 9999px;
    background: #3a3a3a;
    position: relative;
    cursor: pointer;
    flex-shrink: 0;
  }
  .toggle::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #d0d0d0;
    transition: transform 120ms ease;
  }
  .toggle.on { background: var(--accent); }
  .toggle.on::after { transform: translateX(16px); background: #181818; }
</style>
</head>
<body>
<h1>@-mention vocabulary</h1>
<div class="subtitle">Enable or disable each mention kind. Disabled kinds won't appear in the @ picker.</div>
<ul id="list"></ul>
<script>
const vscode = acquireVsCodeApi();
const listEl = document.getElementById('list');

function render(kinds) {
  while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
  for (const kind of kinds) {
    const li = document.createElement('li');
    const token = document.createElement('span');
    token.className = 'token';
    token.textContent = kind.token;
    const desc = document.createElement('span');
    desc.className = 'desc';
    desc.textContent = kind.description;
    const toggle = document.createElement('div');
    toggle.className = 'toggle' + (kind.enabled ? ' on' : '');
    toggle.addEventListener('click', () => {
      vscode.postMessage({
        method: 'eri/atMentions/toggle',
        params: { kind: kind.id, enabled: !kind.enabled },
      });
    });
    li.appendChild(token);
    li.appendChild(desc);
    li.appendChild(toggle);
    listEl.appendChild(li);
  }
}

window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.method === 'eri/atMentions/state' && data.params && Array.isArray(data.params.kinds)) {
    render(data.params.kinds);
  }
});
</script>
</body>
</html>`;
}
