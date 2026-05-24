import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { registerAcceptHandlers } from "./acceptHandler";

const DEBOUNCE_MS = 150;
/// JSON-RPC code emitted by the sidecar while the Tab model is downloading.
const DOWNLOADING_CODE = -32100;

interface CompleteResult {
  text?: string;
  latencyMs?: number;
  model?: string;
}

interface HealthResult {
  ok?: boolean;
  model?: string;
  loaded?: boolean;
  modelPath?: string;
  downloadProgress?: number | null;
  downloadError?: string | null;
}

interface PreloadResult {
  stage?: "downloading" | "loading" | "ready";
  progress?: number;
  modelPath?: string;
}

interface CompleteParams {
  filePath: string;
  prefix: string;
  suffix: string;
  language?: string;
  maxTokens?: number;
  model?: string;
}

interface RpcLikeError {
  code?: number;
  message?: string;
}

function asRpcError(err: unknown): RpcLikeError | null {
  if (typeof err !== "object" || err === null) {
    return null;
  }
  const e = err as { code?: unknown; message?: unknown };
  return {
    code: typeof e.code === "number" ? e.code : undefined,
    message: typeof e.message === "string" ? e.message : undefined,
  };
}

function tryParseDownloadingPayload(message: string | undefined): number | null {
  if (!message) {
    return null;
  }
  try {
    const parsed = JSON.parse(message) as { stage?: string; progress?: number };
    if (parsed.stage === "downloading" && typeof parsed.progress === "number") {
      return parsed.progress;
    }
  } catch {
    return null;
  }
  return null;
}

class DebounceGate {
  private timer: NodeJS.Timeout | null = null;

  wait(token: vscode.CancellationToken): Promise<boolean> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return new Promise((resolve) => {
      const onCancel = token.onCancellationRequested(() => {
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = null;
        }
        onCancel.dispose();
        resolve(false);
      });
      this.timer = setTimeout(() => {
        this.timer = null;
        onCancel.dispose();
        resolve(true);
      }, DEBOUNCE_MS);
    });
  }
}

class DownloadStatus {
  private readonly item: vscode.StatusBarItem;
  private visible = false;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.name = "eri Tab";
  }

  show(progress: number): void {
    const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
    this.item.text = `$(cloud-download) eri Tab: downloading model ${pct}%`;
    this.item.tooltip = "eri Tab is downloading its inline-completion model.";
    if (!this.visible) {
      this.item.show();
      this.visible = true;
    }
  }

  showLoading(): void {
    this.item.text = "$(sync~spin) eri Tab: loading model";
    this.item.tooltip = "eri Tab is warming up.";
    if (!this.visible) {
      this.item.show();
      this.visible = true;
    }
  }

  hide(): void {
    if (this.visible) {
      this.item.hide();
      this.visible = false;
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}

class EriTabProvider implements vscode.InlineCompletionItemProvider {
  private readonly gate = new DebounceGate();

  constructor(
    private readonly sidecarRef: () => Sidecar | null,
    private readonly status: DownloadStatus,
  ) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionList | null> {
    const config = vscode.workspace.getConfiguration("eri.tab");
    if (!config.get<boolean>("enabled", true)) {
      return null;
    }
    const minPrefix = config.get<number>("minPrefixLength", 2);
    const model = config.get<string>("model", "qwen2.5-coder:1.5b");
    const maxTokens = config.get<number>("maxTokens", 64);

    const sidecar = this.sidecarRef();
    if (!sidecar) {
      return null;
    }

    const prefixRange = new vscode.Range(new vscode.Position(0, 0), position);
    const prefix = document.getText(prefixRange);
    if (prefix.length < minPrefix) {
      return null;
    }
    const lastLine = document.lineAt(document.lineCount - 1);
    const suffixRange = new vscode.Range(position, lastLine.range.end);
    const suffix = document.getText(suffixRange);

    const proceed = await this.gate.wait(token);
    if (!proceed || token.isCancellationRequested) {
      return null;
    }

    const params: CompleteParams = {
      filePath: document.uri.fsPath,
      prefix,
      suffix,
      language: document.languageId,
      maxTokens,
      model,
    };

    let result: CompleteResult;
    try {
      result = await sidecar.request<CompleteResult>("eri/tab/complete", params);
    } catch (err) {
      const rpc = asRpcError(err);
      if (rpc && rpc.code === DOWNLOADING_CODE) {
        const progress = tryParseDownloadingPayload(rpc.message) ?? 0;
        this.status.show(progress);
      }
      return null;
    }

    if (token.isCancellationRequested) {
      return null;
    }
    this.status.hide();
    const insertText = result?.text;
    if (typeof insertText !== "string" || insertText.length === 0) {
      return null;
    }

    const range = new vscode.Range(position, position);
    const item: vscode.InlineCompletionItem = {
      insertText,
      range,
    };
    return { items: [item] };
  }
}

async function runHealthCheck(sidecarRef: () => Sidecar | null): Promise<void> {
  const sidecar = sidecarRef();
  if (!sidecar) {
    void vscode.window.showWarningMessage("eri: sidecar not running");
    return;
  }
  const config = vscode.workspace.getConfiguration("eri.tab");
  const model = config.get<string>("model", "qwen2.5-coder:1.5b");

  try {
    const result = await sidecar.request<HealthResult>("eri/tab/health", { model });
    const loaded = result?.loaded === true;
    const ok = result?.ok === true;
    const progress = typeof result?.downloadProgress === "number"
      ? Math.round(result.downloadProgress * 100)
      : null;
    if (loaded && ok) {
      void vscode.window.showInformationMessage(
        `eri Tab: model ${result?.model ?? model} loaded and ready`,
      );
    } else if (progress !== null) {
      void vscode.window.showInformationMessage(
        `eri Tab: downloading model — ${progress}%`,
      );
    } else if (ok) {
      void vscode.window.showInformationMessage(
        `eri Tab: model ${result?.model ?? model} cached, not yet loaded`,
      );
    } else if (result?.downloadError) {
      void vscode.window.showErrorMessage(
        `eri Tab: model download failed — ${result.downloadError}`,
      );
    } else {
      void vscode.window.showWarningMessage(
        `eri Tab: model ${result?.model ?? model} not yet downloaded`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    void vscode.window.showErrorMessage(`eri Tab health check failed: ${msg}`);
  }
}

async function triggerPreload(
  sidecarRef: () => Sidecar | null,
  status: DownloadStatus,
): Promise<void> {
  const sidecar = sidecarRef();
  if (!sidecar) {
    return;
  }
  try {
    const result = await sidecar.request<PreloadResult>("eri/tab/preload", {});
    if (result?.stage === "downloading") {
      status.show(result.progress ?? 0);
    } else if (result?.stage === "loading") {
      status.showLoading();
    } else if (result?.stage === "ready") {
      status.hide();
    }
  } catch {
    // Preload is best-effort; the first /complete call retries.
  }
}

export function activateTab(
  context: vscode.ExtensionContext,
  sidecarRef: () => Sidecar | null,
): void {
  const status = new DownloadStatus();
  context.subscriptions.push({ dispose: () => status.dispose() });

  const provider = new EriTabProvider(sidecarRef, status);
  const selector: vscode.DocumentSelector = { scheme: "file" };
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(selector, provider),
    vscode.commands.registerCommand("eri.tab.health", () => runHealthCheck(sidecarRef)),
    vscode.commands.registerCommand("eri.tab.preload", () => triggerPreload(sidecarRef, status)),
  );

  void triggerPreload(sidecarRef, status);
  registerAcceptHandlers(context);
}
