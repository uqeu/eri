import * as vscode from "vscode";
import { Sidecar, SidecarNotification } from "../sidecar";
import { renderComposerHtml } from "./composerView.html";

export interface ComposerChange {
  path: string;
  kind: "added" | "modified" | "removed";
  diff: string;
}

interface ComposerPlanRequest {
  prompt: string;
}

interface ComposerPlanResponse {
  changes?: ComposerChange[];
}

interface ComposerApplyParams {
  paths?: unknown;
}

const VIEW_TYPE = "eri.composer";

export class ComposerView {
  private panel: vscode.WebviewPanel | null = null;
  private pendingPlan: Promise<void> | null = null;
  private currentChanges: ComposerChange[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getSidecar: () => Sidecar | null,
  ) {}

  open(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      this.postFocus();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      "eri · composer",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.extensionUri],
      },
    );

    const model = this.readDefaultModel();
    this.panel.webview.html = renderComposerHtml(model);
    this.panel.webview.onDidReceiveMessage((message) =>
      this.handleWebviewMessage(message),
    );
    this.panel.onDidDispose(() => {
      this.panel = null;
      this.currentChanges = [];
      this.pendingPlan = null;
    });

    this.postFocus();
  }

  postFromSidecar(notification: SidecarNotification): void {
    if (!this.panel) {
      return;
    }
    this.panel.webview.postMessage(notification);
  }

  applyAll(): void {
    if (!this.panel) {
      vscode.window.showInformationMessage(
        "eri composer: open the composer first (Cmd-I)",
      );
      return;
    }
    if (this.currentChanges.length === 0) {
      vscode.window.showInformationMessage(
        "eri composer: no plan to apply",
      );
      return;
    }
    this.notifyApply(this.currentChanges.map((change) => change.path));
  }

  discard(): void {
    this.currentChanges = [];
    this.getSidecar()?.notify("eri/composer/discard", {});
    this.panel?.webview.postMessage({
      method: "eri/composer/plan/result",
      params: { changes: [] },
    });
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
  }

  private postFocus(): void {
    this.panel?.webview.postMessage({
      method: "eri/composer/focus",
      params: {},
    });
  }

  private readDefaultModel(): string {
    const fromConfig = vscode.workspace
      .getConfiguration("eri")
      .get<string>("model");
    // wire-format model id, not user-visible — the webview maps this to "eri Engine"
    return fromConfig && fromConfig.length > 0 ? fromConfig : "mercury-2";
  }

  private handleWebviewMessage(message: {
    method?: string;
    params?: unknown;
  }): void {
    if (!message.method) {
      return;
    }
    switch (message.method) {
      case "eri/composer/plan/request":
        this.handlePlanRequest(message.params as ComposerPlanRequest | undefined);
        break;
      case "eri/composer/apply":
        this.handleApply(message.params as ComposerApplyParams | undefined);
        break;
      case "eri/composer/discard":
        this.discard();
        break;
      case "eri/composer/close":
        this.panel?.dispose();
        break;
      case "eri/model/cycle":
        this.getSidecar()?.notify("eri/model/cycle", {});
        break;
      default:
        this.getSidecar()?.notify(message.method, message.params ?? {});
        break;
    }
  }

  private handlePlanRequest(params: ComposerPlanRequest | undefined): void {
    const prompt = params?.prompt ?? "";
    if (prompt.trim().length === 0) {
      this.postError("empty prompt");
      return;
    }
    if (this.pendingPlan) {
      this.postError("a plan is already in progress");
      return;
    }
    const sidecar = this.getSidecar();
    if (!sidecar) {
      // Sidecar not running — fall back to an empty stub plan so the UI stays
      // responsive during development.
      this.deliverPlan([]);
      return;
    }

    const files = this.collectWorkspaceFiles();
    this.pendingPlan = sidecar
      .request<ComposerPlanResponse>("eri/composer/plan", { prompt, files })
      .then(
        (response) => {
          const changes = Array.isArray(response?.changes)
            ? response!.changes!
            : [];
          this.deliverPlan(changes);
        },
        (err: Error) => {
          this.postError(err.message);
        },
      )
      .finally(() => {
        this.pendingPlan = null;
      });
  }

  private handleApply(params: ComposerApplyParams | undefined): void {
    const rawPaths = params?.paths;
    if (!Array.isArray(rawPaths)) {
      this.notifyApply(this.currentChanges.map((change) => change.path));
      return;
    }
    const paths = rawPaths.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (paths.length === 0) {
      this.postError("no files selected for apply");
      return;
    }
    this.notifyApply(paths);
  }

  private notifyApply(paths: string[]): void {
    this.getSidecar()?.notify("eri/composer/apply", { paths });
    // Optimistic UI feedback — the sidecar can later emit eri/composer/applied
    // with the authoritative count.
    this.panel?.webview.postMessage({
      method: "eri/composer/applied",
      params: { applied: paths.length },
    });
    this.currentChanges = this.currentChanges.filter(
      (change) => !paths.includes(change.path),
    );
  }

  private deliverPlan(changes: ComposerChange[]): void {
    this.currentChanges = changes.map((change) => ({
      path: String(change.path ?? ""),
      kind:
        change.kind === "added" || change.kind === "removed"
          ? change.kind
          : "modified",
      diff: typeof change.diff === "string" ? change.diff : "",
    }));
    this.panel?.webview.postMessage({
      method: "eri/composer/plan/result",
      params: { changes: this.currentChanges },
    });
  }

  private postError(message: string): void {
    this.panel?.webview.postMessage({
      method: "eri/composer/error",
      params: { message },
    });
  }

  private collectWorkspaceFiles(): string[] {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return [];
    }
    // Skeleton: we hand the sidecar workspace root paths only — it can crawl
    // the tree itself with its own ignore rules. Walking node_modules from
    // here would be slow and noisy.
    return folders.map((folder) => folder.uri.fsPath);
  }
}
