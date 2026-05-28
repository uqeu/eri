"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LayoutSettingsViewProvider = exports.LAYOUT_VIEW_ID = void 0;
const vscode = require("vscode");
const eriTheme_1 = require("../theme/eriTheme");
exports.LAYOUT_VIEW_ID = "eri.layoutSettings";
class LayoutSettingsViewProvider {
    layout;
    view = null;
    subscriptions = [];
    constructor(layout) {
        this.layout = layout;
        this.subscriptions.push(this.layout.onChange((state) => this.refresh(state)));
    }
    resolveWebviewView(view) {
        this.view = view;
        view.webview.options = { enableScripts: true };
        view.webview.html = renderHtml(this.layout.current());
        view.webview.onDidReceiveMessage((message) => this.handleMessage(message));
        view.onDidDispose(() => {
            this.view = null;
        });
    }
    dispose() {
        for (const sub of this.subscriptions)
            sub.dispose();
        this.subscriptions.length = 0;
    }
    refresh(state) {
        if (!this.view)
            return;
        this.view.webview.postMessage({ method: "eri/layout/state", params: state });
    }
    async handleMessage(message) {
        const params = message.params ?? {};
        switch (message.method) {
            case "eri/layout/setMode":
                if (params.mode)
                    await this.layout.setMode(params.mode);
                return;
            case "eri/layout/setChatPosition":
                if (params.chatPosition)
                    await this.layout.setChatPosition(params.chatPosition);
                return;
            case "eri/layout/setExplorerHidden":
                if (typeof params.explorerHidden === "boolean") {
                    await this.layout.setExplorerHidden(params.explorerHidden);
                }
                return;
            case "eri/layout/setPreviewSurface":
                if (params.previewSurface)
                    await this.layout.setPreviewSurface(params.previewSurface);
                return;
            case "eri/layout/openThemeHub":
                await vscode.commands.executeCommand("eri.themes.openHub");
                return;
        }
    }
}
exports.LayoutSettingsViewProvider = LayoutSettingsViewProvider;
function renderHtml(state) {
    const theme = (0, eriTheme_1.resolveTheme)(state.themeSlug);
    const css = (0, eriTheme_1.eriThemeCss)({ theme });
    const initial = JSON.stringify(state);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>Layout</title>
<style>
${css}
body {
  margin: 0;
  padding: 14px;
  background: var(--eri-bg);
  color: var(--eri-text);
  font-family: var(--vscode-font-family);
  font-size: 12px;
  line-height: 1.5;
}
section { margin-bottom: 16px; }
.label { margin-bottom: 6px; }
.group { display: flex; gap: 6px; flex-wrap: wrap; }
button.opt {
  background: var(--eri-bg-card);
  color: var(--eri-text);
  border: 1px solid var(--eri-border);
  border-radius: 6px;
  padding: 4px 10px;
  font: inherit;
  cursor: pointer;
}
button.opt[aria-pressed="true"] {
  background: var(--eri-accent);
  color: var(--eri-accent-ink);
  border-color: var(--eri-accent);
}
label.toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
a.link {
  color: var(--eri-accent);
  text-decoration: none;
  font-size: 11px;
}
a.link:hover { text-decoration: underline; }
</style>
</head>
<body>
<section>
  <div class="label mono-cap">Mode</div>
  <div class="group" data-group="mode">
    <button class="opt" data-value="coder">Coder</button>
    <button class="opt" data-value="eri">eri</button>
  </div>
</section>
<section>
  <div class="label mono-cap">Chat position</div>
  <div class="group" data-group="chatPosition">
    <button class="opt" data-value="left">Left</button>
    <button class="opt" data-value="right">Right</button>
    <button class="opt" data-value="bottom">Bottom</button>
  </div>
</section>
<section>
  <label class="toggle">
    <input type="checkbox" id="explorerHidden">
    Hide Explorer in eri mode
  </label>
</section>
<section>
  <div class="label mono-cap">Preview surface</div>
  <div class="group" data-group="previewSurface">
    <button class="opt" data-value="auto">Auto</button>
    <button class="opt" data-value="swift">Always Swift</button>
    <button class="opt" data-value="webview">Always WebviewPanel</button>
  </div>
</section>
<section>
  <div class="label mono-cap">Theme</div>
  <a class="link" href="#" id="openThemeHub">Open theme marketplace →</a>
</section>
<script>
const vscode = acquireVsCodeApi();
let state = ${initial};

function send(method, params) {
  vscode.postMessage({ method, params: params || {} });
}

function paint() {
  document.querySelectorAll('[data-group]').forEach((group) => {
    const key = group.getAttribute('data-group');
    group.querySelectorAll('button.opt').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-value') === state[key]));
    });
  });
  const explorerCheckbox = document.getElementById('explorerHidden');
  explorerCheckbox.checked = !!state.explorerHiddenInEriMode;
}

document.querySelectorAll('[data-group]').forEach((group) => {
  const key = group.getAttribute('data-group');
  group.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const value = target.getAttribute('data-value');
    if (!value) return;
    if (key === 'mode')             send('eri/layout/setMode',           { mode: value });
    if (key === 'chatPosition')     send('eri/layout/setChatPosition',   { chatPosition: value });
    if (key === 'previewSurface')   send('eri/layout/setPreviewSurface', { previewSurface: value });
  });
});

document.getElementById('explorerHidden').addEventListener('change', (ev) => {
  send('eri/layout/setExplorerHidden', { explorerHidden: ev.target.checked });
});

document.getElementById('openThemeHub').addEventListener('click', (ev) => {
  ev.preventDefault();
  send('eri/layout/openThemeHub');
});

window.addEventListener('message', (event) => {
  if (event.data && event.data.method === 'eri/layout/state' && event.data.params) {
    state = event.data.params;
    paint();
  }
});

paint();
</script>
</body>
</html>`;
}
//# sourceMappingURL=layoutSettingsView.js.map