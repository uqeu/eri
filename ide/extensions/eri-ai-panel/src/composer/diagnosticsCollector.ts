// Collect a compact snapshot of the active linter / language-server
// diagnostics for the iterate + ship requests. The sidecar's
// `system:diagnostics` BudgetPart consumes this so the model sees what's
// broken in the open file set BEFORE editing — closing the gap where
// eri's previous turn only knew the *count* of diagnostics, not what
// they actually said.
//
// We bound the result aggressively: only errors + warnings, only from
// the active editor + currently open files, capped at 30 entries total.
// The sidecar caps again at 40 — these defenses are layered so a
// noisy ESLint sweep can't blow the prompt budget.

import * as vscode from "vscode";

export interface DiagnosticPayload {
  readonly path: string;
  readonly line: number;
  readonly severity: "error" | "warning" | "info" | "hint";
  readonly message: string;
  readonly source?: string;
}

const MAX_DIAGNOSTICS = 30;

export function collectActiveDiagnostics(): DiagnosticPayload[] {
  const out: DiagnosticPayload[] = [];
  const seenUris = new Set<string>();

  const consider = (uri: vscode.Uri): void => {
    const key = uri.toString();
    if (seenUris.has(key)) return;
    seenUris.add(key);
    const list = vscode.languages.getDiagnostics(uri);
    for (const diag of list) {
      if (out.length >= MAX_DIAGNOSTICS) return;
      const sev = mapSeverity(diag.severity);
      if (sev !== "error" && sev !== "warning") continue;
      out.push({
        path: vscode.workspace.asRelativePath(uri),
        line: diag.range.start.line + 1,
        severity: sev,
        message: diag.message,
        source: diag.source && diag.source.length > 0 ? diag.source : undefined,
      });
    }
  };

  // Active editor first so its diagnostics survive any further capping.
  const active = vscode.window.activeTextEditor;
  if (active) {
    consider(active.document.uri);
  }
  for (const editor of vscode.window.visibleTextEditors) {
    if (out.length >= MAX_DIAGNOSTICS) break;
    consider(editor.document.uri);
  }
  // If we still have headroom, scan any other open text documents.
  if (out.length < MAX_DIAGNOSTICS) {
    for (const doc of vscode.workspace.textDocuments) {
      if (out.length >= MAX_DIAGNOSTICS) break;
      consider(doc.uri);
    }
  }
  return out;
}

function mapSeverity(severity: vscode.DiagnosticSeverity): DiagnosticPayload["severity"] {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    case vscode.DiagnosticSeverity.Information:
      return "info";
    case vscode.DiagnosticSeverity.Hint:
      return "hint";
  }
}
