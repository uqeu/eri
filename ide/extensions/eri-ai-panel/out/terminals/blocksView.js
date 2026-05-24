"use strict";
// Side-panel webview that lists Warp-style command blocks for the focused
// terminal. Pure presentation; all data comes from BlockStore.
Object.defineProperty(exports, "__esModule", { value: true });
exports.TerminalBlocksView = void 0;
const vscode = require("vscode");
class TerminalBlocksView {
    store;
    onSend;
    onRerun;
    static viewId = "eri.terminalBlocks";
    view;
    selection = {
        terminalKey: undefined,
        terminalName: "(no terminal selected)",
    };
    constructor(store, onSend, onRerun) {
        this.store = store;
        this.onSend = onSend;
        this.onRerun = onRerun;
        this.store.onDidChange(() => this.render());
    }
    resolveWebviewView(view) {
        this.view = view;
        view.webview.options = { enableScripts: true };
        view.webview.onDidReceiveMessage((message) => this.handleMessage(message));
        this.render();
    }
    focus(selection) {
        this.selection = selection;
        this.render();
    }
    async handleMessage(message) {
        if (message.kind === "ready") {
            this.render();
            return;
        }
        const block = this.currentBlocks().find((b) => b.id === message.blockId);
        if (!block) {
            return;
        }
        switch (message.kind) {
            case "copy":
                await vscode.env.clipboard.writeText(block.command);
                vscode.window.setStatusBarMessage("Block command copied", 2000);
                break;
            case "rerun":
                await this.onRerun(block);
                break;
            case "send":
                await this.onSend(block);
                break;
        }
    }
    currentBlocks() {
        if (!this.selection.terminalKey) {
            return [];
        }
        return this.store.list(this.selection.terminalKey, 30);
    }
    render() {
        if (!this.view) {
            return;
        }
        const blocks = this.currentBlocks();
        this.view.webview.html = renderHtml(this.selection.terminalName, blocks);
    }
}
exports.TerminalBlocksView = TerminalBlocksView;
function renderHtml(terminalName, blocks) {
    const items = blocks.length === 0
        ? `<div class="empty">No commands captured yet for <strong>${escapeHtml(terminalName)}</strong>.<br/>Shell integration may need to be enabled (bash, zsh, fish, pwsh supported).</div>`
        : blocks.map(renderBlock).join("");
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  body { font: 12px var(--vscode-font-family); padding: 8px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
  .header { font-weight: 600; margin-bottom: 8px; display: flex; justify-content: space-between; }
  .empty { opacity: 0.7; padding: 12px; text-align: center; line-height: 1.6; }
  .block { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 6px; padding: 6px 8px; }
  .block.fail { border-left: 3px solid var(--vscode-errorForeground); }
  .block.ok { border-left: 3px solid var(--vscode-charts-green, #4caf50); }
  .cmd { font-family: var(--vscode-editor-font-family); word-break: break-all; margin-bottom: 4px; }
  .meta { font-size: 11px; opacity: 0.7; display: flex; gap: 8px; margin-bottom: 4px; }
  .actions { display: flex; gap: 4px; }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 2px 8px; cursor: pointer; border-radius: 3px; font: inherit; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
</style></head>
<body>
  <div class="header"><span>${escapeHtml(terminalName)}</span><span>${blocks.length} blocks</span></div>
  ${items}
  <script>
    const vscode = acquireVsCodeApi();
    vscode.postMessage({ kind: "ready" });
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.dataset.action;
      const blockId = target.dataset.blockId;
      if (action && blockId) {
        vscode.postMessage({ kind: action, blockId });
      }
    });
  </script>
</body></html>`;
}
function renderBlock(block) {
    const cls = block.exitCode === 0 ? "ok" : block.exitCode === null ? "" : "fail";
    const badge = block.exitCode === 0
        ? "✓ exit 0"
        : block.exitCode === null
            ? "running…"
            : `✗ exit ${block.exitCode}`;
    const duration = formatDuration(block.durationMs);
    return `<div class="block ${cls}">
    <div class="cmd">${escapeHtml(block.command)}</div>
    <div class="meta"><span>${badge}</span><span>${duration}</span></div>
    <div class="actions">
      <button data-action="copy" data-block-id="${block.id}">Copy</button>
      <button data-action="rerun" data-block-id="${block.id}">Re-run</button>
      <button data-action="send" data-block-id="${block.id}">Send to chat</button>
    </div>
  </div>`;
}
function formatDuration(ms) {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    const seconds = ms / 1000;
    if (seconds < 60) {
        return `${seconds.toFixed(1)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds - minutes * 60);
    return `${minutes}m ${remainder}s`;
}
function escapeHtml(input) {
    return input
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
//# sourceMappingURL=blocksView.js.map