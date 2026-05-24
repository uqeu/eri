import * as vscode from "vscode";
import { ReviewReport, SEVERITY_RANK, Severity } from "./types";

/**
 * Webview panel that renders a full review report — useful when the tree
 * view's flat layout isn't enough (e.g. user wants to skim long descriptions
 * with markdown formatting). One panel per process; reusing it replaces the
 * content.
 */
export class ReviewReportPanel {
  private static current: ReviewReportPanel | null = null;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static show(report: ReviewReport, context: vscode.ExtensionContext): void {
    if (ReviewReportPanel.current) {
      ReviewReportPanel.current.render(report);
      ReviewReportPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "eri.review.report",
      "eri-review report",
      vscode.ViewColumn.Beside,
      { enableScripts: false, retainContextWhenHidden: true },
    );
    ReviewReportPanel.current = new ReviewReportPanel(panel, context);
    ReviewReportPanel.current.render(report);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    _context: vscode.ExtensionContext,
  ) {
    this.panel = panel;
    panel.onDidDispose(
      () => {
        ReviewReportPanel.current = null;
        for (const d of this.disposables) {
          d.dispose();
        }
      },
      null,
      this.disposables,
    );
  }

  private render(report: ReviewReport): void {
    this.panel.webview.html = renderHtml(report);
  }
}

function renderHtml(report: ReviewReport): string {
  const findings = [...report.findings].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      a.file.localeCompare(b.file) ||
      a.line_range[0] - b.line_range[0],
  );
  const breakdown = countBy(report.findings.map((f) => f.severity));
  const totals = (Object.keys(SEVERITY_RANK) as Severity[])
    .sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])
    .map((sev) => `<span class="sev sev-${sev}">${sev}: ${breakdown[sev] ?? 0}</span>`)
    .join(" · ");

  const items = findings
    .map((f) => {
      const fix = f.suggested_fix
        ? `<pre class="fix"><code>${escape(f.suggested_fix)}</code></pre>`
        : "";
      return `
        <section class="finding sev-${f.severity}">
          <header>
            <span class="badge sev-${f.severity}">${f.severity}</span>
            <span class="category">${f.category}</span>
            <code class="path">${escape(f.file)}</code>
            <span class="lines">L${f.line_range[0]}–${f.line_range[1]}</span>
            <span class="conf">conf ${f.confidence.toFixed(2)}</span>
          </header>
          <h3>${escape(f.title)}</h3>
          <p>${escape(f.description)}</p>
          ${fix}
        </section>
      `;
    })
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font-family: var(--vscode-font-family); padding: 1rem; }
  header.report { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: .5rem; margin-bottom: 1rem; }
  .sev { font-size: .85em; margin-right: .5em; }
  .sev-critical { color: var(--vscode-errorForeground); font-weight: 600; }
  .sev-high { color: var(--vscode-editorWarning-foreground); font-weight: 600; }
  .sev-medium { color: var(--vscode-editorInfo-foreground); }
  .sev-low, .sev-info { color: var(--vscode-descriptionForeground); }
  section.finding { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: .75rem 1rem; margin-bottom: .75rem; }
  section.finding header { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; font-size: .85em; }
  .badge { padding: 0 .4em; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .path { font-family: var(--vscode-editor-font-family); color: var(--vscode-textLink-foreground); }
  pre.fix { background: var(--vscode-textBlockQuote-background); padding: .5rem; overflow-x: auto; }
  h3 { margin: .5rem 0 .25rem; }
</style></head><body>
  <header class="report">
    <h2>eri-review report</h2>
    <div>${report.findings.length} findings · ${report.total_files} files · ${report.elapsed_ms}ms · model <code>${escape(report.model)}</code></div>
    <div>${totals}</div>
  </header>
  ${items || "<p>No findings.</p>"}
</body></html>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function countBy(values: ReadonlyArray<Severity>): Partial<Record<Severity, number>> {
  const out: Partial<Record<Severity, number>> = {};
  for (const v of values) {
    out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}
