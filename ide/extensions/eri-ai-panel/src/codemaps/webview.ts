import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { currentWorkspaceFsPath } from "./view";

interface SvgResponse {
  readonly name: string;
  readonly svg: string;
}

const panels = new Map<string, vscode.WebviewPanel>();

export async function openCodemapWebview(
  name: string,
  getSidecar: () => Sidecar | null,
): Promise<void> {
  const existing = panels.get(name);
  if (existing) {
    existing.reveal(vscode.ViewColumn.Active);
    return;
  }

  const sidecar = getSidecar();
  const workspace = currentWorkspaceFsPath();
  if (!sidecar || !workspace) {
    vscode.window.showWarningMessage(
      "eri Codemaps — sidecar offline or no workspace open",
    );
    return;
  }

  let svg = "";
  try {
    const result = await sidecar.request<SvgResponse>("eri/codemaps/svg", {
      workspace,
      name,
    });
    svg = typeof result?.svg === "string" ? result.svg : "";
  } catch (err) {
    vscode.window.showErrorMessage(
      `eri Codemaps — failed to load ${name}: ${errorMessage(err)}`,
    );
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "eri.codemap",
    `Codemap · ${name}`,
    vscode.ViewColumn.Active,
    {
      enableScripts: false,
      retainContextWhenHidden: true,
    },
  );
  panel.webview.html = renderHtml(name, svg);
  panel.onDidDispose(() => {
    panels.delete(name);
  });
  panels.set(name, panel);
}

function renderHtml(name: string, svg: string): string {
  const safeName = escapeHtml(name);
  const body = svg.trim().length > 0 ? svg : "<p>(empty codemap)</p>";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;" />
    <title>Codemap ${safeName}</title>
    <style>
      body {
        margin: 0;
        padding: 16px;
        background: #0b0d10;
        color: #e6edf3;
        font-family: var(--vscode-font-family, system-ui, sans-serif);
      }
      header {
        margin-bottom: 12px;
        font-size: 13px;
        opacity: 0.85;
      }
      .canvas {
        background: #0b0d10;
        border-radius: 6px;
        overflow: auto;
      }
      svg {
        display: block;
        max-width: 100%;
        height: auto;
      }
    </style>
  </head>
  <body>
    <header>eri · codemap · <strong>${safeName}</strong></header>
    <div class="canvas">${body}</div>
  </body>
</html>`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
