"use strict";
// Webview view rendering the curated MCP catalog grouped by category.
// Each card exposes "Install" (and "Reconfigure" once installed).
//
// Messages to the host:
//   { kind: "install", presetId: string }
//   { kind: "refresh" }
//
// Messages from the host:
//   { kind: "state", sections: [...] }
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpPresetsBrowseView = exports.PRESETS_VIEW_ID = void 0;
const vscode = require("vscode");
const catalog_1 = require("./catalog");
const flow_1 = require("./flow");
const installer_1 = require("./installer");
exports.PRESETS_VIEW_ID = "eri.mcpPresets";
class McpPresetsBrowseView {
    context;
    secrets;
    view = null;
    constructor(context, secrets) {
        this.context = context;
        this.secrets = secrets;
    }
    async resolveWebviewView(view) {
        this.view = view;
        view.webview.options = { enableScripts: true };
        view.webview.html = renderHtml();
        view.webview.onDidReceiveMessage((msg) => {
            void this.handleMessage(msg);
        }, undefined, this.context.subscriptions);
        view.onDidDispose(() => {
            this.view = null;
        });
        await this.pushState();
    }
    async refresh() {
        await this.pushState();
    }
    async handleMessage(msg) {
        if (msg.kind === "install") {
            await (0, flow_1.addServer)(msg.presetId, {
                secrets: this.secrets,
                onChange: () => {
                    void this.pushState();
                },
            });
            return;
        }
        if (msg.kind === "refresh") {
            await this.pushState();
        }
    }
    async pushState() {
        if (!this.view) {
            return;
        }
        const includeBeta = vscode.workspace
            .getConfiguration("eri")
            .get("mcpPresets.includeBeta") ?? false;
        const presets = (0, catalog_1.visiblePresets)({ includeBeta });
        const installed = new Set(await (0, installer_1.listInstalledServerIds)());
        const grouped = (0, catalog_1.presetsByCategory)(presets);
        const sections = catalog_1.CATEGORY_ORDER.flatMap((category) => {
            const list = grouped.get(category);
            if (!list) {
                return [];
            }
            return [
                {
                    category,
                    label: catalog_1.CATEGORY_LABELS[category],
                    presets: list.map((preset) => toRenderPreset(preset, installed)),
                },
            ];
        });
        await this.view.webview.postMessage({ kind: "state", sections });
    }
}
exports.McpPresetsBrowseView = McpPresetsBrowseView;
function toRenderPreset(preset, installed) {
    return {
        id: preset.id,
        displayName: preset.displayName,
        description: preset.description,
        category: preset.category,
        categoryLabel: catalog_1.CATEGORY_LABELS[preset.category],
        requiresKeys: preset.requiredEnv.some((envVar) => envVar.secret),
        isReadOnly: preset.isReadOnly,
        installed: installed.has(preset.id),
    };
}
function renderHtml() {
    // Inline CSS + JS — no external assets. The CSP forbids remote loads. All
    // DOM construction goes through textContent / createElement (never
    // innerHTML) to avoid any XSS surface even though the data is host-supplied.
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
    <title>MCP starter pack</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background: transparent;
        padding: 12px;
      }
      .hint { opacity: 0.7; margin: 0 0 12px; }
      .section { margin-bottom: 18px; }
      .section h3 {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        opacity: 0.6;
        margin: 0 0 6px;
      }
      .card {
        border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25));
        border-radius: 6px;
        padding: 10px 12px;
        margin-bottom: 8px;
        background: var(--vscode-editor-background);
      }
      .card .title {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }
      .card .name { font-weight: 600; }
      .card .badges {
        font-size: 10px;
        opacity: 0.7;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .card p { margin: 6px 0 8px; opacity: 0.85; }
      .card button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 4px;
        padding: 4px 10px;
        cursor: pointer;
        font: inherit;
      }
      .card button:hover { background: var(--vscode-button-hoverBackground); }
      .status {
        display: inline-block;
        margin-left: 8px;
        font-size: 11px;
        opacity: 0.7;
      }
      .empty { opacity: 0.6; font-style: italic; }
    </style>
  </head>
  <body>
    <p class="hint">Curated MCP servers from the public Model Context Protocol ecosystem. Each runs locally on your machine.</p>
    <div id="root"></div>
    <script>
      const vscode = acquireVsCodeApi();
      const root = document.getElementById('root');

      function el(tag, attrs, children) {
        const node = document.createElement(tag);
        if (attrs) {
          for (const [k, v] of Object.entries(attrs)) {
            if (k === 'class') node.className = v;
            else if (k === 'onclick') node.addEventListener('click', v);
            else node.setAttribute(k, v);
          }
        }
        if (children) {
          for (const child of children) {
            if (child == null) continue;
            if (typeof child === 'string') node.appendChild(document.createTextNode(child));
            else node.appendChild(child);
          }
        }
        return node;
      }

      function clear(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
      }

      function render(sections) {
        clear(root);
        if (!sections || sections.length === 0) {
          root.appendChild(el('p', { class: 'empty' }, ['No servers in the catalog.']));
          return;
        }
        for (const section of sections) {
          const wrap = el('div', { class: 'section' });
          wrap.appendChild(el('h3', null, [section.label]));
          for (const preset of section.presets) {
            const card = el('div', { class: 'card' });
            const badges = [];
            if (preset.requiresKeys) badges.push('needs key');
            if (preset.isReadOnly) badges.push('read-only');
            card.appendChild(el('div', { class: 'title' }, [
              el('span', { class: 'name' }, [preset.displayName]),
              el('span', { class: 'badges' }, [badges.join(' · ')]),
            ]));
            card.appendChild(el('p', null, [preset.description]));
            const installed = preset.installed;
            const presetId = preset.id;
            card.appendChild(el('button', {
              onclick: () => vscode.postMessage({ kind: 'install', presetId: presetId }),
            }, [installed ? 'Reconfigure' : 'Install']));
            if (installed) {
              card.appendChild(el('span', { class: 'status' }, ['configured']));
            }
            wrap.appendChild(card);
          }
          root.appendChild(wrap);
        }
      }

      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg && msg.kind === 'state') {
          render(msg.sections);
        }
      });

      vscode.postMessage({ kind: 'refresh' });
    </script>
  </body>
</html>`;
}
//# sourceMappingURL=browseView.js.map