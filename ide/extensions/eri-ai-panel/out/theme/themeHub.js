"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerThemeHub = registerThemeHub;
const vscode = require("vscode");
/**
 * Opens a QuickPick over the Phase 23 theme marketplace. Selecting an
 * entry persists `eri.layout.themeSlug` so chat / composer / settings
 * webviews re-render with the new palette next time they refresh, and
 * (best-effort) tells the sidecar so future prompts inject the matching
 * design tokens.
 */
function registerThemeHub(context, getSidecar) {
    context.subscriptions.push(vscode.commands.registerCommand("eri.themes.openHub", async () => {
        await openThemeHub(getSidecar);
    }));
}
async function openThemeHub(getSidecar) {
    const sidecar = getSidecar();
    let themes = [];
    if (sidecar) {
        try {
            const report = await sidecar.request("eri/themes/list", {});
            themes = report.themes ?? [];
        }
        catch (err) {
            vscode.window.showWarningMessage(`eri themes — sidecar list failed: ${getErrorMessage(err)}. Showing built-in defaults.`);
        }
    }
    if (themes.length === 0) {
        themes = DEFAULT_FALLBACK;
    }
    const items = themes.map((t) => ({
        label: t.displayName ?? t.slug,
        description: t.family ?? "",
        detail: t.description ?? "",
        themeSlug: t.slug,
    }));
    const picked = await vscode.window.showQuickPick(items, {
        title: "eri Themes",
        placeHolder: "Pick a marketplace theme. Affects chat + composer chrome.",
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!picked)
        return;
    const cfg = vscode.workspace.getConfiguration("eri.layout");
    await cfg.update("themeSlug", picked.themeSlug, vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global);
    // Best-effort: tell the sidecar so subsequent prompt builds inject
    // the matching design-token block.
    if (sidecar) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspaceFolder) {
            try {
                await sidecar.request("eri/themes/setActive", {
                    workspace: workspaceFolder,
                    slug: picked.themeSlug,
                });
            }
            catch {
                /* best-effort */
            }
        }
    }
    vscode.window.setStatusBarMessage(`eri theme set to ${picked.label}. Reopen chat to see the new palette.`, 3000);
}
const DEFAULT_FALLBACK = [
    { slug: "anthropic", family: "brand", displayName: "Anthropic", description: "Lime accent on near-black — the demo default." },
    { slug: "linear", family: "brand", displayName: "Linear", description: "Indigo accent, calm whites." },
    { slug: "cursor", family: "brand", displayName: "Cursor", description: "Green accent on warm dark." },
    { slug: "shadcn-default", family: "shadcn", displayName: "shadcn default", description: "Mono palette with white accent." },
];
function getErrorMessage(err) {
    if (err instanceof Error)
        return err.message;
    return "Unknown error";
}
//# sourceMappingURL=themeHub.js.map