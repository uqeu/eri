"use strict";
// Binds account state + usage into the eri status bar item.
//
// The base statusBar.ts is a state machine (idle / listening / thinking …).
// We attach an extra item to the LEFT of the workbench items (priority 999)
// dedicated to account + tier + tokens — that way the existing item stays
// focused on runtime state and we don't fight over labels.
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateAccountStatusBar = activateAccountStatusBar;
const vscode = require("vscode");
const types_1 = require("./types");
const usageClient_1 = require("./usageClient");
const SIGN_IN_COMMAND = "eri.account.signIn";
const SHOW_STATUS_COMMAND = "eri.account.showStatus";
const ACCENT_YELLOW = "#F5E867";
const ACCENT_WARN = "#E5C07B";
const ACCENT_BAD = "#EF4444";
const MUTED = "#9AA4AD";
function activateAccountStatusBar(context) {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 999);
    item.name = "eri account";
    context.subscriptions.push(item);
    let session = null;
    let usage = null;
    const render = () => {
        if (!session) {
            item.text = "$(sparkle) eri · sign in to use";
            item.tooltip = "Sign in to eri to enable hosted models.";
            item.color = MUTED;
            item.command = SIGN_IN_COMMAND;
            item.show();
            return;
        }
        const tierLabel = types_1.TIER_LABELS[session.tier];
        if (!usage) {
            item.text = `$(sparkle) eri · ${tierLabel}`;
            item.tooltip = buildSignedInTooltip(session, null);
            item.color = ACCENT_YELLOW;
            item.command = SHOW_STATUS_COMMAND;
            item.show();
            return;
        }
        const pct = (0, usageClient_1.remainingIncludedPct)(usage);
        const color = pct < 10 ? ACCENT_BAD : pct < 25 ? ACCENT_WARN : ACCENT_YELLOW;
        item.text = `$(sparkle) eri · ${tierLabel} · ${Math.round(pct)}% left`;
        item.tooltip = buildSignedInTooltip(session, usage);
        item.color = color;
        item.command = SHOW_STATUS_COMMAND;
        item.show();
    };
    render();
    return {
        setSession(next) {
            session = next;
            render();
        },
        setUsage(next) {
            usage = next;
            render();
        },
        dispose() {
            item.dispose();
        },
    };
}
function buildSignedInTooltip(session, usage) {
    const md = new vscode.MarkdownString("", true);
    md.isTrusted = false;
    md.appendMarkdown(`**eri** — ${types_1.TIER_LABELS[session.tier]}\n\n`);
    md.appendMarkdown(`Signed in as \`${session.email}\`\n\n`);
    if (usage) {
        md.appendMarkdown(`Used: ${fmt(usage.tokensUsed)} / ${fmt(usage.tokensIncluded)} included\n\n`);
        md.appendMarkdown(`Ghost zone left: ${fmt(usage.remainingGhost)}\n\n`);
        if (usage.softCapWarning) {
            md.appendMarkdown(`_Soft cap reached — using ghost-zone tokens._\n\n`);
        }
    }
    md.appendMarkdown("Click to open account & usage.");
    return md;
}
function fmt(n) {
    if (!Number.isFinite(n))
        return "0";
    return Math.round(n).toLocaleString("en-US");
}
//# sourceMappingURL=statusBarBinding.js.map