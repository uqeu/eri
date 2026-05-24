"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SidebarGaze = void 0;
const vscode = require("vscode");
const CONTEXT_KEY = "eri.gaze.attendingSidebar";
/// Sets a VSCode context key when the user dwells on the sidebar long
/// enough to fire an AttentionEvent. UI surfaces (view-welcome, tree
/// item descriptions) can use the context key for subtle highlighting.
/// Never auto-clicks anything.
class SidebarGaze {
    service;
    subs = [];
    active = false;
    constructor(service) {
        this.service = service;
        this.subs.push(this.service.onAttention((event) => this.handle(event)));
    }
    isEnabled() {
        return vscode.workspace
            .getConfiguration("eri.gaze")
            .get("sidebarAttention", true);
    }
    handle(event) {
        if (!this.isEnabled() && this.active) {
            this.setActive(false);
            return;
        }
        if (event.region !== "sidebar") {
            if (event.kind === "leave" && this.active) {
                this.setActive(false);
            }
            return;
        }
        if (event.kind === "enter") {
            this.setActive(true);
        }
        else {
            this.setActive(false);
        }
    }
    setActive(active) {
        if (this.active === active) {
            return;
        }
        this.active = active;
        void vscode.commands.executeCommand("setContext", CONTEXT_KEY, active);
    }
    dispose() {
        if (this.active) {
            void vscode.commands.executeCommand("setContext", CONTEXT_KEY, false);
        }
        for (const sub of this.subs) {
            sub.dispose();
        }
        this.subs.length = 0;
    }
}
exports.SidebarGaze = SidebarGaze;
//# sourceMappingURL=sidebarGaze.js.map