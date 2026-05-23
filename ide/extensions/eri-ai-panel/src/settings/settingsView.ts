// BYOK settings WebviewView — renders the provider list with set/unset status
// and Add/Edit/Remove actions. All secrets are entered via
// `vscode.window.showInputBox({ password: true })`. The webview never sees the
// secret value.

import * as fs from "fs";
import * as vscode from "vscode";
import {
  PROVIDERS,
  ProviderField,
  ProviderSpec,
  getProvider,
  getProviderField,
} from "./providers";
import { SecretsStore } from "./secrets";

export const BYOK_VIEW_ID = "eri.byok";

interface FieldStatusPayload {
  readonly key: string;
  readonly label: string;
  readonly isSet: boolean;
}

interface ProviderStatusPayload {
  readonly id: string;
  readonly displayName: string;
  readonly fields: ReadonlyArray<FieldStatusPayload>;
}

interface StatePayload {
  readonly providers: ReadonlyArray<ProviderStatusPayload>;
}

interface IncomingMessage {
  readonly type?: string;
  readonly providerId?: string;
  readonly fieldKey?: string;
}

export class ByokSettingsView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly secrets: SecretsStore,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media", "byok"),
      ],
    };
    view.webview.html = this.loadHtml();
    view.webview.onDidReceiveMessage((raw: unknown) => {
      void this.handleMessage(raw);
    });
    view.onDidDispose(() => {
      this.view = null;
    });
  }

  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const state = await this.buildState();
    await this.view.webview.postMessage({ type: "state", state });
  }

  reveal(): void {
    this.view?.show?.(true);
  }

  async promptAndStore(
    providerId: string,
    fieldKey: string,
  ): Promise<boolean> {
    const provider = getProvider(providerId);
    const field = getProviderField(providerId, fieldKey);
    if (!provider || !field) {
      return false;
    }
    const value = await vscode.window.showInputBox({
      title: `${provider.displayName} — ${field.label}`,
      prompt: `Enter ${field.label} for ${provider.displayName}`,
      placeHolder: field.placeholder,
      password: field.kind === "password",
      ignoreFocusOut: true,
      validateInput: (input: string): string | null => {
        if (!field.validator) {
          return null;
        }
        return field.validator(input);
      },
    });
    if (typeof value !== "string" || value.length === 0) {
      return false;
    }
    await this.secrets.set(providerId, fieldKey, value);
    await this.refresh();
    return true;
  }

  async removeField(providerId: string, fieldKey: string): Promise<void> {
    const provider = getProvider(providerId);
    const field = getProviderField(providerId, fieldKey);
    if (!provider || !field) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Remove ${field.label} for ${provider.displayName}?`,
      { modal: true },
      "Remove",
    );
    if (confirm !== "Remove") {
      return;
    }
    await this.secrets.clear(providerId, fieldKey);
    await this.refresh();
  }

  async clearAll(): Promise<void> {
    const confirmation = await vscode.window.showInputBox({
      title: "Clear ALL stored API keys",
      prompt: 'Type "clear" to confirm removing every stored key.',
      placeHolder: "clear",
      ignoreFocusOut: true,
    });
    if (confirmation !== "clear") {
      return;
    }
    await this.secrets.clearAll();
    await this.refresh();
    void vscode.window.showInformationMessage("eri: all stored API keys cleared.");
  }

  async pickAndSet(): Promise<void> {
    const providerPick = await vscode.window.showQuickPick(
      PROVIDERS.map((provider: ProviderSpec) => ({
        label: provider.displayName,
        description: provider.id,
        provider,
      })),
      { title: "Select provider", ignoreFocusOut: true },
    );
    if (!providerPick) {
      return;
    }
    const fieldPick =
      providerPick.provider.fields.length === 1
        ? providerPick.provider.fields[0]
        : await this.pickField(providerPick.provider);
    if (!fieldPick) {
      return;
    }
    await this.promptAndStore(providerPick.provider.id, fieldPick.key);
  }

  private async pickField(
    provider: ProviderSpec,
  ): Promise<ProviderField | undefined> {
    const picked = await vscode.window.showQuickPick(
      provider.fields.map((field: ProviderField) => ({
        label: field.label,
        description: field.key,
        field,
      })),
      { title: `${provider.displayName} — choose field`, ignoreFocusOut: true },
    );
    return picked?.field;
  }

  private async handleMessage(raw: unknown): Promise<void> {
    if (typeof raw !== "object" || raw === null) {
      return;
    }
    const message = raw as IncomingMessage;
    switch (message.type) {
      case "ready":
        await this.refresh();
        return;
      case "set":
        if (
          typeof message.providerId === "string" &&
          typeof message.fieldKey === "string"
        ) {
          await this.promptAndStore(message.providerId, message.fieldKey);
        }
        return;
      case "remove":
        if (
          typeof message.providerId === "string" &&
          typeof message.fieldKey === "string"
        ) {
          await this.removeField(message.providerId, message.fieldKey);
        }
        return;
      case "clearAll":
        await this.clearAll();
        return;
      default:
        return;
    }
  }

  private async buildState(): Promise<StatePayload> {
    const providers: ProviderStatusPayload[] = [];
    for (const provider of PROVIDERS) {
      const fields: FieldStatusPayload[] = [];
      for (const field of provider.fields) {
        const isSet = await this.secrets.has(provider.id, field.key);
        fields.push({ key: field.key, label: field.label, isSet });
      }
      providers.push({
        id: provider.id,
        displayName: provider.displayName,
        fields,
      });
    }
    return { providers };
  }

  private loadHtml(): string {
    const htmlPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      "media",
      "byok",
      "index.html",
    ).fsPath;
    return fs.readFileSync(htmlPath, "utf8");
  }
}
