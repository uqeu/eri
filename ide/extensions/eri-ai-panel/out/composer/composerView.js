"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComposerView = void 0;
const vscode = require("vscode");
const composerView_html_1 = require("./composerView.html");
const VIEW_TYPE = "eri.composer";
class ComposerView {
    context;
    getSidecar;
    panel = null;
    pendingPlan = null;
    currentChanges = [];
    constructor(context, getSidecar) {
        this.context = context;
        this.getSidecar = getSidecar;
    }
    open() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Active);
            this.postFocus();
            return;
        }
        this.panel = vscode.window.createWebviewPanel(VIEW_TYPE, "eri · composer", vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [this.context.extensionUri],
        });
        const model = this.readDefaultModel();
        this.panel.webview.html = (0, composerView_html_1.renderComposerHtml)(model);
        this.panel.webview.onDidReceiveMessage((message) => this.handleWebviewMessage(message));
        this.panel.onDidDispose(() => {
            this.panel = null;
            this.currentChanges = [];
            this.pendingPlan = null;
        });
        this.postFocus();
    }
    postFromSidecar(notification) {
        if (!this.panel) {
            return;
        }
        this.panel.webview.postMessage(notification);
    }
    applyAll() {
        if (!this.panel) {
            vscode.window.showInformationMessage("eri composer: open the composer first (Cmd-I)");
            return;
        }
        if (this.currentChanges.length === 0) {
            vscode.window.showInformationMessage("eri composer: no plan to apply");
            return;
        }
        this.notifyApply(this.currentChanges.map((change) => change.path));
    }
    discard() {
        this.currentChanges = [];
        this.getSidecar()?.notify("eri/composer/discard", {});
        this.panel?.webview.postMessage({
            method: "eri/composer/plan/result",
            params: { changes: [] },
        });
    }
    dispose() {
        this.panel?.dispose();
        this.panel = null;
    }
    postFocus() {
        this.panel?.webview.postMessage({
            method: "eri/composer/focus",
            params: {},
        });
    }
    readDefaultModel() {
        const fromConfig = vscode.workspace
            .getConfiguration("eri")
            .get("model");
        // wire-format model id, not user-visible — the webview maps this to "eri Engine"
        return fromConfig && fromConfig.length > 0 ? fromConfig : "mercury-2";
    }
    handleWebviewMessage(message) {
        if (!message.method) {
            return;
        }
        switch (message.method) {
            case "eri/composer/plan/request":
                this.handlePlanRequest(message.params);
                break;
            case "eri/composer/apply":
                this.handleApply(message.params);
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
    handlePlanRequest(params) {
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
            .request("eri/composer/plan", { prompt, files })
            .then((response) => {
            const changes = Array.isArray(response?.changes)
                ? response.changes
                : [];
            this.deliverPlan(changes);
        }, (err) => {
            this.postError(err.message);
        })
            .finally(() => {
            this.pendingPlan = null;
        });
    }
    handleApply(params) {
        const rawPaths = params?.paths;
        if (!Array.isArray(rawPaths)) {
            this.notifyApply(this.currentChanges.map((change) => change.path));
            return;
        }
        const paths = rawPaths.filter((value) => typeof value === "string" && value.length > 0);
        if (paths.length === 0) {
            this.postError("no files selected for apply");
            return;
        }
        this.notifyApply(paths);
    }
    notifyApply(paths) {
        this.getSidecar()?.notify("eri/composer/apply", { paths });
        // Optimistic UI feedback — the sidecar can later emit eri/composer/applied
        // with the authoritative count.
        this.panel?.webview.postMessage({
            method: "eri/composer/applied",
            params: { applied: paths.length },
        });
        this.currentChanges = this.currentChanges.filter((change) => !paths.includes(change.path));
    }
    deliverPlan(changes) {
        this.currentChanges = changes.map((change) => ({
            path: String(change.path ?? ""),
            kind: change.kind === "added" || change.kind === "removed"
                ? change.kind
                : "modified",
            diff: typeof change.diff === "string" ? change.diff : "",
        }));
        this.panel?.webview.postMessage({
            method: "eri/composer/plan/result",
            params: { changes: this.currentChanges },
        });
    }
    postError(message) {
        this.panel?.webview.postMessage({
            method: "eri/composer/error",
            params: { message },
        });
    }
    collectWorkspaceFiles() {
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
exports.ComposerView = ComposerView;
//# sourceMappingURL=composerView.js.map