"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmbeddedPreview = createEmbeddedPreview;
const vscode = require("vscode");
const eriTheme_1 = require("../theme/eriTheme");
/**
 * eri-mode preview surface. A vscode.WebviewPanel that docks beside the
 * editor and renders the workspace's dev-server URL inside an iframe.
 * Mirrors the marketing demo's centred preview without forking workbench
 * chrome.
 *
 * Gaze relay: the panel's outer document draws a lime ring overlay at
 * the posted (x, y) coordinates. When the URL is same-origin (or a
 * file://) we can also resolve the element under the gaze and surface
 * its CSS selector to the chrome header. Cross-origin iframes fall back
 * to coordinate-only rendering — the user still sees the ring, just no
 * "looking · {selector}" hint.
 */
function createEmbeddedPreview(context) {
    let panel = null;
    let currentUrl = null;
    let currentTheme = "anthropic";
    const selectorEmitter = new vscode.EventEmitter();
    function ensurePanel() {
        if (panel)
            return panel;
        panel = vscode.window.createWebviewPanel("eri.embeddedPreview", "eri Preview", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [context.extensionUri],
        });
        panel.onDidDispose(() => {
            panel = null;
            currentUrl = null;
        });
        panel.webview.onDidReceiveMessage((msg) => {
            if (msg.method === "eri/preview/selector" && msg.params?.selector) {
                selectorEmitter.fire(msg.params.selector);
            }
        });
        return panel;
    }
    return {
        async open({ url, themeSlug }) {
            const p = ensurePanel();
            currentUrl = url;
            currentTheme = themeSlug;
            p.webview.html = renderHtml(url, themeSlug);
            p.reveal(vscode.ViewColumn.Beside, true);
        },
        close() {
            panel?.dispose();
            panel = null;
            currentUrl = null;
        },
        reload() {
            if (!panel || !currentUrl)
                return;
            // Re-render so the iframe's `src` cache-busts; postMessage to the
            // iframe document would only work for same-origin pages.
            panel.webview.html = renderHtml(currentUrl, currentTheme);
        },
        relayGaze(x, y) {
            if (!panel)
                return;
            void panel.webview.postMessage({
                method: "eri/preview/gaze",
                params: { x, y },
            });
        },
        isOpen() {
            return panel !== null;
        },
        onSelectorChange: selectorEmitter.event,
        dispose() {
            panel?.dispose();
            panel = null;
            selectorEmitter.dispose();
        },
    };
}
function renderHtml(url, themeSlug) {
    const theme = (0, eriTheme_1.resolveTheme)(themeSlug);
    const css = (0, eriTheme_1.eriThemeCss)({ theme });
    const safeUrl = JSON.stringify(url);
    const escapedHost = escapeHtml(formatHost(url));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src http: https: file: vscode-resource:; img-src http: https: data:;">
<title>eri Preview</title>
<style>
${css}
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  background: var(--eri-bg);
  color: var(--eri-text);
  font-family: var(--vscode-font-family);
  overflow: hidden;
}
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}
header.chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--eri-bg-card);
  border-bottom: 1px solid var(--eri-border);
}
header.chrome .title {
  display: flex;
  align-items: center;
  gap: 10px;
}
header.chrome .url {
  color: var(--eri-text-muted);
  font-family: var(--eri-font-mono);
  font-size: 11px;
}
.looking {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--eri-font-mono);
  font-size: 11px;
  color: var(--eri-text-muted);
}
.looking .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--eri-accent);
  box-shadow: 0 0 8px var(--eri-accent);
}
.frame-wrap {
  position: relative;
  flex: 1;
  overflow: hidden;
}
iframe.frame {
  width: 100%;
  height: 100%;
  border: 0;
  background: white;
}
#gazeRing {
  position: absolute;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  border: 2px solid var(--eri-accent);
  box-shadow: 0 0 14px var(--eri-accent);
  pointer-events: none;
  opacity: 0;
  transform: translate(-50%, -50%);
  transition: opacity 250ms ease-out, left 90ms ease-out, top 90ms ease-out;
}
</style>
</head>
<body>
<div class="shell">
  <header class="chrome">
    <div class="title">
      <span class="mono-cap">Preview · live</span>
      <span class="url">${escapedHost}</span>
    </div>
    <div class="looking" id="looking">
      <span class="dot"></span>
      <span id="selector">looking · idle</span>
    </div>
  </header>
  <div class="frame-wrap">
    <iframe class="frame" id="frame" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
    <div id="gazeRing"></div>
  </div>
</div>
<script>
const vscode = acquireVsCodeApi();
const frame = document.getElementById('frame');
const ring = document.getElementById('gazeRing');
const selectorEl = document.getElementById('selector');
const wrap = document.querySelector('.frame-wrap');

frame.src = ${safeUrl};

let hideTimer = null;
window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.method === 'eri/preview/gaze' && data.params) {
    const rect = wrap.getBoundingClientRect();
    const px = data.params.x * rect.width;
    const py = data.params.y * rect.height;
    ring.style.left = px + 'px';
    ring.style.top = py + 'px';
    ring.style.opacity = '1';
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { ring.style.opacity = '0'; }, 900);

    try {
      const doc = frame.contentDocument;
      if (doc) {
        const el = doc.elementFromPoint(data.params.x * frame.clientWidth, data.params.y * frame.clientHeight);
        if (el) {
          const tag = el.tagName ? el.tagName.toLowerCase() : 'node';
          const id = el.id ? ('#' + el.id) : '';
          const cls = (typeof el.className === 'string' && el.className) ? ('.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')) : '';
          const sel = tag + id + cls;
          selectorEl.textContent = 'looking · ' + sel;
          vscode.postMessage({ method: 'eri/preview/selector', params: { selector: sel } });
          return;
        }
      }
    } catch (_) {
      // Cross-origin iframe — fall through to coordinate-only display.
    }
    selectorEl.textContent = 'looking · (' + Math.round(data.params.x * 100) + '%, ' + Math.round(data.params.y * 100) + '%)';
  }
});
</script>
</body>
</html>`;
}
function formatHost(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol === "file:") {
            const file = parsed.pathname.split("/").pop() ?? "local file";
            return `dev · ${file}`;
        }
        return `dev · ${parsed.host}`;
    }
    catch {
        return url;
    }
}
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
//# sourceMappingURL=embeddedPreview.js.map