"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.severityIcon = exports.ReviewFindingsProvider = exports.FindingNode = exports.FileGroupNode = void 0;
const vscode = require("vscode");
const types_1 = require("./types");
Object.defineProperty(exports, "severityIcon", { enumerable: true, get: function () { return types_1.severityIcon; } });
/**
 * Tree-view nodes. Two levels: file groups (parent), findings (leaf).
 */
class FileGroupNode {
    file;
    findings;
    kind = "file";
    constructor(file, findings) {
        this.file = file;
        this.findings = findings;
    }
}
exports.FileGroupNode = FileGroupNode;
class FindingNode {
    finding;
    kind = "finding";
    constructor(finding) {
        this.finding = finding;
    }
}
exports.FindingNode = FindingNode;
/**
 * Provides the eri.review tree view. Holds the most recent report and renders
 * it grouped by file, severity-sorted.
 */
class ReviewFindingsProvider {
    report = null;
    status = "No review run yet.";
    _onDidChange = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChange.event;
    setReport(report) {
        this.report = report;
        this.status = null;
        this._onDidChange.fire(undefined);
    }
    setStatus(message) {
        this.status = message;
        this._onDidChange.fire(undefined);
    }
    clear() {
        this.report = null;
        this.status = "No review run yet.";
        this._onDidChange.fire(undefined);
    }
    currentReport() {
        return this.report;
    }
    findFinding(file, title) {
        if (!this.report) {
            return null;
        }
        return (this.report.findings.find((f) => f.file === file && f.title === title) ?? null);
    }
    getTreeItem(element) {
        if (element.kind === "file") {
            const item = new vscode.TreeItem(element.file, vscode.TreeItemCollapsibleState.Expanded);
            item.description = `${element.findings.length} finding${element.findings.length === 1 ? "" : "s"}`;
            item.iconPath = new vscode.ThemeIcon("file");
            item.contextValue = "eri.review.file";
            return item;
        }
        const f = element.finding;
        const item = new vscode.TreeItem(f.title, vscode.TreeItemCollapsibleState.None);
        item.description = `${f.severity} • L${f.line_range[0]}-${f.line_range[1]}`;
        item.tooltip = `${f.severity.toUpperCase()} • ${f.category}\n${f.description}`;
        item.iconPath = themeIconForSeverity(f.severity);
        item.contextValue = f.suggested_fix
            ? "eri.review.finding.fixable"
            : "eri.review.finding";
        item.command = {
            command: "eri.review.openFinding",
            title: "Open finding",
            arguments: [{ file: f.file, title: f.title }],
        };
        return item;
    }
    getChildren(element) {
        if (this.status && !this.report) {
            // No data — show a single placeholder finding-shaped node.
            return [];
        }
        if (!this.report) {
            return [];
        }
        if (!element) {
            // Group by file.
            const byFile = new Map();
            for (const f of this.report.findings) {
                const bucket = byFile.get(f.file) ?? [];
                bucket.push(f);
                byFile.set(f.file, bucket);
            }
            const groups = [];
            for (const [file, findings] of byFile) {
                findings.sort((a, b) => types_1.SEVERITY_RANK[b.severity] - types_1.SEVERITY_RANK[a.severity] ||
                    a.line_range[0] - b.line_range[0]);
                groups.push(new FileGroupNode(file, findings));
            }
            groups.sort((a, b) => a.file.localeCompare(b.file));
            return groups;
        }
        if (element.kind === "file") {
            return element.findings.map((f) => new FindingNode(f));
        }
        return [];
    }
    dispose() {
        this._onDidChange.dispose();
    }
}
exports.ReviewFindingsProvider = ReviewFindingsProvider;
function themeIconForSeverity(sev) {
    // VS Code icon names — we don't use `severityIcon()` markup string here
    // because `iconPath` wants a `ThemeIcon`, not a `$(name)` token.
    // Kept as a sibling helper so commands can still reuse severityIcon().
    switch (sev) {
        case "critical":
            return new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"));
        case "high":
            return new vscode.ThemeIcon("warning", new vscode.ThemeColor("editorWarning.foreground"));
        case "medium":
            return new vscode.ThemeIcon("issue-opened");
        case "low":
            return new vscode.ThemeIcon("info");
        case "info":
            return new vscode.ThemeIcon("comment");
    }
}
//# sourceMappingURL=findingsView.js.map