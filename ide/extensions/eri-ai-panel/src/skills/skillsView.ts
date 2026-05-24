import * as vscode from "vscode";

export interface SkillSummary {
  readonly name: string;
  readonly description: string;
  readonly when: ReadonlyArray<string>;
}

export class SkillNode extends vscode.TreeItem {
  constructor(public readonly skill: SkillSummary) {
    super(skill.name, vscode.TreeItemCollapsibleState.None);
    this.description = skill.when.length > 0 ? skill.when.join(", ") : "";
    this.tooltip = buildTooltip(skill);
    this.contextValue = "eri.skill";
    this.iconPath = new vscode.ThemeIcon("symbol-event");
  }
}

function buildTooltip(skill: SkillSummary): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = false;
  md.appendMarkdown(`**${skill.name}**\n\n`);
  if (skill.description) {
    md.appendMarkdown(`${skill.description}\n\n`);
  }
  if (skill.when.length > 0) {
    md.appendMarkdown(`_Triggers:_ \`${skill.when.join("`, `")}\`\n`);
  }
  return md;
}

export class SkillsTreeDataProvider
  implements vscode.TreeDataProvider<SkillNode>
{
  private readonly emitter = new vscode.EventEmitter<SkillNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<SkillNode | undefined> =
    this.emitter.event;

  private skills: ReadonlyArray<SkillSummary> = [];
  private placeholderMessage: string | null = "No skills loaded yet.";

  getTreeItem(element: SkillNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SkillNode): vscode.ProviderResult<SkillNode[]> {
    if (element) {
      return [];
    }
    if (this.skills.length === 0) {
      const placeholder = new SkillNode({
        name: this.placeholderMessage ?? "No skills found.",
        description: "Add SKILL.md files under .eri/skills/<name>/",
        when: [],
      });
      placeholder.contextValue = "eri.skill.placeholder";
      placeholder.iconPath = new vscode.ThemeIcon("info");
      return [placeholder];
    }
    return this.skills.map((skill) => new SkillNode(skill));
  }

  setSkills(skills: ReadonlyArray<SkillSummary>): void {
    this.skills = skills;
    this.placeholderMessage = null;
    this.emitter.fire(undefined);
  }

  setError(message: string): void {
    this.skills = [];
    this.placeholderMessage = message;
    this.emitter.fire(undefined);
  }
}
