"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillsTreeDataProvider = exports.SkillNode = void 0;
const vscode = require("vscode");
class SkillNode extends vscode.TreeItem {
    skill;
    constructor(skill) {
        super(skill.name, vscode.TreeItemCollapsibleState.None);
        this.skill = skill;
        this.description = skill.when.length > 0 ? skill.when.join(", ") : "";
        this.tooltip = buildTooltip(skill);
        this.contextValue = "eri.skill";
        this.iconPath = new vscode.ThemeIcon("symbol-event");
    }
}
exports.SkillNode = SkillNode;
function buildTooltip(skill) {
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
class SkillsTreeDataProvider {
    emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    skills = [];
    placeholderMessage = "No skills loaded yet.";
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
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
    setSkills(skills) {
        this.skills = skills;
        this.placeholderMessage = null;
        this.emitter.fire(undefined);
    }
    setError(message) {
        this.skills = [];
        this.placeholderMessage = message;
        this.emitter.fire(undefined);
    }
}
exports.SkillsTreeDataProvider = SkillsTreeDataProvider;
//# sourceMappingURL=skillsView.js.map