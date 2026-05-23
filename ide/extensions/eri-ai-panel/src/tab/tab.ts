import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { registerAcceptHandlers } from "./acceptHandler";

const DEBOUNCE_MS = 150;

interface CompleteResult {
  text?: string;
  latencyMs?: number;
  model?: string;
}

interface HealthResult {
  ok?: boolean;
  model?: string;
  baseUrl?: string;
}

interface CompleteParams {
  filePath: string;
  prefix: string;
  suffix: string;
  language?: string;
  maxTokens?: number;
  model?: string;
  baseUrl?: string;
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

class EriTabProvider implements vscode.InlineCompletionItemProvider {
  private readonly gate = new DebounceGate();

  constructor(private readonly sidecarRef: () => Sidecar | null) {}

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
    const baseUrl = config.get<string>("baseUrl", "http://localhost:11434");

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
      baseUrl,
    };

    let result: CompleteResult;
    try {
      result = await sidecar.request<CompleteResult>("eri/tab/complete", params);
    } catch (err) {
      void err;
      return null;
    }

    if (token.isCancellationRequested) {
      return null;
    }
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
  const baseUrl = config.get<string>("baseUrl", "http://localhost:11434");

  try {
    const result = await sidecar.request<HealthResult>("eri/tab/health", {
      model,
      baseUrl,
    });
    if (result?.ok === true) {
      void vscode.window.showInformationMessage(
        `eri tab: Ollama reachable at ${result.baseUrl ?? baseUrl} (model ${result.model ?? model})`,
      );
    } else {
      void vscode.window.showWarningMessage(
        `eri tab: Ollama not reachable at ${result?.baseUrl ?? baseUrl}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    void vscode.window.showErrorMessage(`eri tab health check failed: ${msg}`);
  }
}

export function activateTab(
  context: vscode.ExtensionContext,
  sidecarRef: () => Sidecar | null,
): void {
  const provider = new EriTabProvider(sidecarRef);
  const selector: vscode.DocumentSelector = { scheme: "file" };
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(selector, provider),
    vscode.commands.registerCommand("eri.tab.health", () => runHealthCheck(sidecarRef)),
  );
  registerAcceptHandlers(context);
}
