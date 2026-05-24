// Side-panel webview that lists Warp-style command blocks for the focused
// terminal. Pure presentation; all data comes from BlockStore.

import * as vscode from "vscode";
import { BlockStore, TerminalBlock } from "./blocks";

export interface BlocksViewSelection {
  readonly terminalKey: string | undefined;
  readonly terminalName: string;
}

type WebviewMessage =
  | { readonly kind: "ready" }
  | { readonly kind: "copy"; readonly blockId: string }
  | { readonly kind: "rerun"; readonly blockId: string }
  | { readonly kind: "send"; readonly blockId: string };

export class TerminalBlocksView implements vscode.WebviewViewProvider {
  static readonly viewId = "eri.terminalBlocks";

  private view: vscode.WebviewView | undefined;
  private selection: BlocksViewSelection = {
    terminalKey: undefined,
    terminalName: "(no terminal selected)",
  };

  constructor(
    private readonly store: BlockStore,
    private readonly onSend: (block: TerminalBlock) => Promise<void>,
    private readonly onRerun: (block: TerminalBlock) => Promise<void>,
  ) {
    this.store.onDidChange(() => this.render());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage((message: WebviewMessage) =>
      this.handleMessage(message),
    );
    this.render();
  }

  focus(selection: BlocksViewSelection): void {
    this.selection = selection;
    this.render();
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
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

  private currentBlocks(): ReadonlyArray<TerminalBlock> {
    if (!this.selection.terminalKey) {
      return [];
    }
    return this.store.list(this.selection.terminalKey, 30);
  }

  private render(): void {
    if (!this.view) {
      return;
    }
    const blocks = this.currentBlocks();
    this.view.webview.html = renderHtml(this.selection.terminalName, blocks);
  }
}

function renderHtml(
  terminalName: string,
  blocks: ReadonlyArray<TerminalBlock>,
): string {
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

function renderBlock(block: TerminalBlock): string {
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

function formatDuration(ms: number): string {
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

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
