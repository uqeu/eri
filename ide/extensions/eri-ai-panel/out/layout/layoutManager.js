"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LayoutManager = void 0;
exports.applyModeSideEffects = applyModeSideEffects;
exports.applyChatPosition = applyChatPosition;
const vscode = require("vscode");
const layoutState_1 = require("./layoutState");
const CONFIG_SECTION = "eri.layout";
class LayoutManager {
    cached;
    listeners = new Set();
    disposable;
    constructor() {
        this.cached = this.readFromConfig();
        this.disposable = vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(CONFIG_SECTION)) {
                const next = this.readFromConfig();
                if (!sameLayout(next, this.cached)) {
                    this.cached = next;
                    this.notify();
                }
            }
        });
    }
    current() {
        return this.cached;
    }
    async setMode(mode) {
        await this.writeConfig("mode", mode);
    }
    async setChatPosition(position) {
        await this.writeConfig("chatPosition", position);
    }
    async setExplorerHidden(hidden) {
        await this.writeConfig("explorerHiddenInEriMode", hidden);
    }
    async setPreviewSurface(surface) {
        await this.writeConfig("previewSurface", surface);
    }
    async setThemeSlug(slug) {
        await this.writeConfig("themeSlug", slug);
    }
    onChange(listener) {
        this.listeners.add(listener);
        return new vscode.Disposable(() => this.listeners.delete(listener));
    }
    dispose() {
        this.disposable.dispose();
        this.listeners.clear();
    }
    readFromConfig() {
        const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
        return (0, layoutState_1.normalizeLayout)({
            mode: cfg.get("mode", layoutState_1.DEFAULT_LAYOUT_STATE.mode),
            chatPosition: cfg.get("chatPosition", layoutState_1.DEFAULT_LAYOUT_STATE.chatPosition),
            explorerHiddenInEriMode: cfg.get("explorerHiddenInEriMode", layoutState_1.DEFAULT_LAYOUT_STATE.explorerHiddenInEriMode),
            previewSurface: cfg.get("previewSurface", layoutState_1.DEFAULT_LAYOUT_STATE.previewSurface),
            themeSlug: cfg.get("themeSlug", layoutState_1.DEFAULT_LAYOUT_STATE.themeSlug),
        });
    }
    async writeConfig(key, value) {
        const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const target = workspaceTarget();
        await cfg.update(key, value, target);
        // onDidChangeConfiguration fires asynchronously — refresh cache eagerly
        // so callers reading `current()` right after a setter see the new value.
        this.cached = this.readFromConfig();
        this.notify();
    }
    notify() {
        for (const listener of this.listeners) {
            try {
                listener(this.cached);
            }
            catch (err) {
                console.error("LayoutManager listener threw:", err);
            }
        }
    }
}
exports.LayoutManager = LayoutManager;
function sameLayout(a, b) {
    return (a.mode === b.mode &&
        a.chatPosition === b.chatPosition &&
        a.explorerHiddenInEriMode === b.explorerHiddenInEriMode &&
        a.previewSurface === b.previewSurface &&
        a.themeSlug === b.themeSlug);
}
function workspaceTarget() {
    // Prefer workspace settings when one is open so .vscode/settings.json
    // captures the layout choice for the project; fall back to global so
    // first-launch (no workspace) still persists.
    return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
}
/**
 * Apply the side-effects of a mode change: explorer visibility, layout
 * orientation, and which preview surface coordinator should drive. We
 * issue the workbench commands here so `setMode()` callers don't have
 * to repeat the boilerplate. Errors are swallowed (worst case the user
 * runs the workbench command themselves).
 */
async function applyModeSideEffects(state) {
    try {
        if (state.mode === "eri" && state.explorerHiddenInEriMode) {
            await vscode.commands.executeCommand("workbench.action.closeSidebar");
        }
        else if (state.mode === "coder") {
            // Show the activity bar + sidebar back so the user lands on their
            // explorer (or whichever view they had open before flipping).
            await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
        }
    }
    catch {
        /* best-effort */
    }
}
/**
 * Move the eri Chat view to match the user's chatPosition setting.
 * VS Code doesn't have a stable public API to swap a view between
 * containers, so we fall back to the layered approach:
 *   - left / right: flip the sidebar's side via the workbench command
 *     (the eri activity-bar view follows it automatically)
 *   - bottom: try the (internal but widely used) moveView command to
 *     drop the eri panel into the bottom panel area; on failure, surface
 *     a one-shot tip so the user can drag it themselves
 *
 * Wired from a LayoutManager.onChange listener so the setting actually
 * moves the chat panel today instead of being a no-op preference.
 */
async function applyChatPosition(position) {
    try {
        if (position === "left" || position === "right") {
            // Read the current sidebar side from the workbench config and
            // toggle only when it doesn't match. Avoids flicker when the user
            // re-picks the same value.
            const cfg = vscode.workspace.getConfiguration("workbench");
            const current = cfg.get("sideBar.location", "left");
            if (current !== position) {
                await vscode.commands.executeCommand("workbench.action.toggleSidebarPosition");
            }
            // Focus the eri activity bar so the user sees the result.
            await vscode.commands.executeCommand("workbench.view.extension.eri-activitybar");
            return;
        }
        // Bottom: move the eri Chat view ("eri.panel") to the bottom panel.
        try {
            await vscode.commands.executeCommand("vscode.moveViews", {
                viewIds: ["eri.panel"],
                destinationId: "workbench.view.panel",
            });
        }
        catch {
            void vscode.window.showInformationMessage("eri: drag the Chat panel into the bottom panel to dock it there. eri remembered your choice.");
        }
    }
    catch {
        /* best-effort */
    }
}
//# sourceMappingURL=layoutManager.js.map