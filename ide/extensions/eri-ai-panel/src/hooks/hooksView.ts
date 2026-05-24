import * as vscode from "vscode";

export interface HookSummary {
  readonly event: string;
  readonly matcher: string | null;
  readonly command: string;
  readonly background: boolean;
  readonly timeoutMs: number;
}

export class HookNode extends vscode.TreeItem {
  constructor(public readonly hook: HookSummary) {
    super(hook.event, vscode.TreeItemCollapsibleState.None);
    this.description = preview(hook.command);
    this.tooltip = buildTooltip(hook);
    this.contextValue = "eri.hook";
    this.iconPath = new vscode.ThemeIcon(
      hook.background ? "sync~spin" : "zap",
    );
  }
}

function preview(command: string): string {
  const limit = 60;
  if (command.length <= limit) {
    return command;
  }
  return `${command.slice(0, limit)}…`;
}

function buildTooltip(hook: HookSummary): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = false;
  md.appendMarkdown(`**${hook.event}**\n\n`);
  if (hook.matcher) {
    md.appendMarkdown(`Matcher: \`${hook.matcher}\`\n\n`);
  }
  md.appendCodeblock(hook.command, "shell");
  md.appendMarkdown(
    `\n_${hook.background ? "background" : "foreground"} • ${hook.timeoutMs}ms_`,
  );
  return md;
}

export class HooksTreeDataProvider
  implements vscode.TreeDataProvider<HookNode>
{
  private readonly emitter = new vscode.EventEmitter<HookNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<HookNode | undefined> =
    this.emitter.event;

  private hooks: ReadonlyArray<HookSummary> = [];
  private placeholderMessage: string | null = "No hooks configured.";

  getTreeItem(element: HookNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: HookNode): vscode.ProviderResult<HookNode[]> {
    if (element) {
      return [];
    }
    if (this.hooks.length === 0) {
      const placeholder = new HookNode({
        event: this.placeholderMessage ?? "No hooks found.",
        matcher: null,
        command: "Edit .eri/hooks.json to add a hook",
        background: false,
        timeoutMs: 0,
      });
      placeholder.contextValue = "eri.hook.placeholder";
      placeholder.iconPath = new vscode.ThemeIcon("info");
      return [placeholder];
    }
    return this.hooks.map((hook) => new HookNode(hook));
  }

  setHooks(hooks: ReadonlyArray<HookSummary>): void {
    this.hooks = hooks;
    this.placeholderMessage = null;
    this.emitter.fire(undefined);
  }

  setError(message: string): void {
    this.hooks = [];
    this.placeholderMessage = message;
    this.emitter.fire(undefined);
  }
}
