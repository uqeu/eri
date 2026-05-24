import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { ReviewFindingsProvider, FindingNode, FileGroupNode } from "./findingsView";
import { ReviewReportPanel } from "./panel";
import {
  Forge,
  ReviewFinding,
  ReviewKind,
  ReviewReport,
} from "./types";

interface RunOptions {
  readonly sidecar: Sidecar | null;
  readonly provider: ReviewFindingsProvider;
  readonly context: vscode.ExtensionContext;
}

/**
 * Resolve the active workspace folder. Bails politely if none is open — the
 * sidecar needs a path to run `git diff` in.
 */
function activeWorkspace(): string | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? folder.uri.fsPath : null;
}

async function withStatus<T>(
  label: string,
  provider: ReviewFindingsProvider,
  task: () => Promise<T>,
): Promise<T | null> {
  provider.setStatus(label);
  try {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: label },
      task,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    provider.setStatus(`Review failed: ${msg}`);
    vscode.window.showErrorMessage(`eri-review: ${msg}`);
    return null;
  }
}

async function runLocal(
  kind: ReviewKind,
  base: string | undefined,
  head: string | undefined,
  opts: RunOptions,
): Promise<void> {
  const { sidecar, provider, context } = opts;
  if (!sidecar) {
    vscode.window.showWarningMessage("eri-review: sidecar not running.");
    return;
  }
  const workspace = activeWorkspace();
  if (!workspace) {
    vscode.window.showWarningMessage(
      "eri-review: open a workspace folder first.",
    );
    return;
  }
  const report = await withStatus("Running eri-review…", provider, async () => {
    return (await sidecar.request("eri/review/local", {
      workspace,
      kind,
      base,
      head,
    })) as ReviewReport;
  });
  if (report) {
    provider.setReport(report);
    notifyDone(report);
    ReviewReportPanel.show(report, context);
  }
}

async function runPr(opts: RunOptions): Promise<void> {
  const { sidecar, provider, context } = opts;
  if (!sidecar) {
    vscode.window.showWarningMessage("eri-review: sidecar not running.");
    return;
  }
  const workspace = activeWorkspace();
  if (!workspace) {
    vscode.window.showWarningMessage(
      "eri-review: open a workspace folder first.",
    );
    return;
  }
  const forge = (await vscode.window.showQuickPick(
    ["github", "gitlab", "forgejo"],
    { placeHolder: "Which forge?" },
  )) as Forge | undefined;
  if (!forge) {
    return;
  }
  const url = await vscode.window.showInputBox({
    prompt:
      forge === "forgejo"
        ? "Paste the Forgejo/Gitea PR URL (https://your.forge/owner/repo/pulls/123)"
        : forge === "github"
          ? "Paste the GitHub PR URL"
          : "Paste the GitLab MR URL",
    validateInput: (v) => (v.startsWith("http") ? null : "Must be a full URL"),
  });
  if (!url) {
    return;
  }
  const params = await buildPrParams(forge, url, workspace);
  if (!params) {
    return;
  }
  const report = await withStatus(
    `Reviewing ${forge} PR…`,
    provider,
    async () =>
      (await sidecar.request("eri/review/pr", params)) as ReviewReport,
  );
  if (report) {
    provider.setReport(report);
    notifyDone(report);
    ReviewReportPanel.show(report, context);
  }
}

async function buildPrParams(
  forge: Forge,
  url: string,
  workspace: string,
): Promise<Record<string, unknown> | null> {
  if (forge === "forgejo") {
    // https://forge.example.com/owner/repo/pulls/123
    const match = url.match(/^(https?:\/\/[^/]+)\/([^/]+)\/([^/]+)\/pulls\/(\d+)/);
    if (!match) {
      vscode.window.showErrorMessage(
        "eri-review: Forgejo URL must look like https://host/owner/repo/pulls/123",
      );
      return null;
    }
    return {
      workspace,
      forge,
      instanceUrl: match[1],
      owner: match[2],
      repo: match[3],
      pr: Number(match[4]),
    };
  }
  return { workspace, forge, url };
}

async function runPatch(opts: RunOptions): Promise<void> {
  const { sidecar, provider, context } = opts;
  if (!sidecar) {
    vscode.window.showWarningMessage("eri-review: sidecar not running.");
    return;
  }
  const workspace = activeWorkspace();
  if (!workspace) {
    vscode.window.showWarningMessage(
      "eri-review: open a workspace folder first.",
    );
    return;
  }
  // Use editor selection if present, otherwise prompt for a clipboard paste.
  const editor = vscode.window.activeTextEditor;
  let patch =
    editor && !editor.selection.isEmpty
      ? editor.document.getText(editor.selection)
      : "";
  if (!patch.trim()) {
    const fromClipboard = await vscode.window.showInformationMessage(
      "Paste a unified diff from the clipboard?",
      { modal: false },
      "Yes",
      "Cancel",
    );
    if (fromClipboard !== "Yes") {
      return;
    }
    patch = await vscode.env.clipboard.readText();
  }
  if (!patch.trim()) {
    vscode.window.showWarningMessage("eri-review: no patch supplied.");
    return;
  }
  const report = await withStatus("Reviewing patch…", provider, async () =>
    (await sidecar.request("eri/review/patch", { workspace, patch })) as ReviewReport,
  );
  if (report) {
    provider.setReport(report);
    notifyDone(report);
    ReviewReportPanel.show(report, context);
  }
}

async function applyFix(
  arg: unknown,
  sidecar: Sidecar | null,
  provider: ReviewFindingsProvider,
): Promise<void> {
  if (!sidecar) {
    return;
  }
  const finding = resolveFinding(arg, provider);
  if (!finding || !finding.suggested_fix) {
    vscode.window.showInformationMessage(
      "eri-review: no suggested fix for this finding.",
    );
    return;
  }
  const workspace = activeWorkspace();
  if (!workspace) {
    return;
  }
  try {
    // Reuse the existing apply pipeline.
    await sidecar.request("eri/apply/parse_and_run", {
      root: workspace,
      text: finding.suggested_fix,
    });
    vscode.window.showInformationMessage(
      `eri-review: applied fix for "${finding.title}"`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`eri-review: failed to apply fix — ${msg}`);
  }
}

function openFinding(arg: unknown, provider: ReviewFindingsProvider): void {
  const finding = resolveFinding(arg, provider);
  if (!finding) {
    return;
  }
  const workspace = activeWorkspace();
  if (!workspace) {
    return;
  }
  const uri = vscode.Uri.file(
    require("path").join(workspace, finding.file),
  );
  vscode.workspace.openTextDocument(uri).then(
    (doc) => {
      const start = Math.max(0, finding.line_range[0] - 1);
      const end = Math.max(start, finding.line_range[1] - 1);
      const range = new vscode.Range(start, 0, end, 0);
      vscode.window.showTextDocument(doc, { selection: range });
    },
    () => {
      vscode.window.showWarningMessage(
        `eri-review: could not open ${finding.file}`,
      );
    },
  );
}

function resolveFinding(
  arg: unknown,
  provider: ReviewFindingsProvider,
): ReviewFinding | null {
  if (arg instanceof FindingNode) {
    return arg.finding;
  }
  if (
    arg &&
    typeof arg === "object" &&
    "file" in arg &&
    "title" in arg &&
    typeof (arg as { file: unknown }).file === "string" &&
    typeof (arg as { title: unknown }).title === "string"
  ) {
    const ref = arg as { file: string; title: string };
    return provider.findFinding(ref.file, ref.title);
  }
  return null;
}

function notifyDone(report: ReviewReport): void {
  const counts: Record<string, number> = {};
  for (const f of report.findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  const tagline = (
    ["critical", "high", "medium", "low", "info"] as const
  )
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${s}`)
    .join(", ");
  vscode.window.showInformationMessage(
    `eri-review: ${report.findings.length} findings (${tagline || "none"}) across ${report.total_files} files`,
  );
}

/**
 * Register all review commands.
 */
export function registerReviewCommands(
  context: vscode.ExtensionContext,
  provider: ReviewFindingsProvider,
  getSidecar: () => Sidecar | null,
): vscode.Disposable[] {
  const opts = (): RunOptions => ({
    sidecar: getSidecar(),
    provider,
    context,
  });
  return [
    vscode.commands.registerCommand("eri.review.local", () =>
      runLocal("unstaged", undefined, undefined, opts()),
    ),
    vscode.commands.registerCommand("eri.review.staged", () =>
      runLocal("staged", undefined, undefined, opts()),
    ),
    vscode.commands.registerCommand("eri.review.range", async () => {
      const base = await vscode.window.showInputBox({
        prompt: "Base revision (e.g. main)",
        value: "main",
      });
      if (!base) {
        return;
      }
      const head = await vscode.window.showInputBox({
        prompt: "Head revision (e.g. HEAD)",
        value: "HEAD",
      });
      if (!head) {
        return;
      }
      await runLocal("range", base, head, opts());
    }),
    vscode.commands.registerCommand("eri.review.pr", () => runPr(opts())),
    vscode.commands.registerCommand("eri.review.patch", () => runPatch(opts())),
    vscode.commands.registerCommand("eri.review.applyFix", (arg) =>
      applyFix(arg, getSidecar(), provider),
    ),
    vscode.commands.registerCommand("eri.review.openFinding", (arg) =>
      openFinding(arg, provider),
    ),
    vscode.commands.registerCommand("eri.review.openReport", () => {
      const report = provider.currentReport();
      if (!report) {
        vscode.window.showInformationMessage(
          "eri-review: no report to display — run a review first.",
        );
        return;
      }
      ReviewReportPanel.show(report, context);
    }),
    vscode.commands.registerCommand("eri.review.clear", () => provider.clear()),
    vscode.commands.registerCommand(
      "eri.review.dismiss",
      (arg: FindingNode | undefined) => {
        if (!(arg instanceof FindingNode)) {
          return;
        }
        const report = provider.currentReport();
        if (!report) {
          return;
        }
        const remaining = report.findings.filter(
          (f) =>
            !(
              f.file === arg.finding.file && f.title === arg.finding.title
            ),
        );
        provider.setReport({ ...report, findings: remaining });
      },
    ),
  ];
}

export { FindingNode, FileGroupNode };
