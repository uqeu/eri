import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { registerAcceptHandlers } from "./acceptHandler";

const DEBOUNCE_MS = 150;

interface SidecarRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

interface SidecarSuggestion {
  insertText?: string;
  range?: SidecarRange;
}

interface SuggestParams {
  uri: string;
  languageId: string;
  prefix: string;
  suffix: string;
  cursor: { line: number; character: number };
  modelOverride?: string;
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

function toRange(range: SidecarRange | undefined, fallback: vscode.Range): vscode.Range {
  if (!range) {
    return fallback;
  }
  try {
    return new vscode.Range(
      new vscode.Position(range.start.line, range.start.character),
      new vscode.Position(range.end.line, range.end.character),
    );
  } catch {
    return fallback;
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
    const modelOverride = config.get<string>("modelOverride", "");

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

    const params: SuggestParams = {
      uri: document.uri.toString(),
      languageId: document.languageId,
      prefix,
      suffix,
      cursor: { line: position.line, character: position.character },
    };
    if (modelOverride && modelOverride.trim().length > 0) {
      params.modelOverride = modelOverride;
    }

    let result: SidecarSuggestion;
    try {
      result = await sidecar.request<SidecarSuggestion>("eri/tab/suggest", params);
    } catch (err) {
      console.debug("[eri.tab] suggest request failed", err);
      return null;
    }

    if (token.isCancellationRequested) {
      return null;
    }
    const insertText = result?.insertText;
    if (typeof insertText !== "string" || insertText.length === 0) {
      return null;
    }

    const fallbackRange = new vscode.Range(position, position);
    const range = toRange(result.range, fallbackRange);

    const item: vscode.InlineCompletionItem = {
      insertText,
      range,
    };
    return { items: [item] };
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
  );
  registerAcceptHandlers(context);
}
