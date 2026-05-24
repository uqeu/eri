"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatFocus = void 0;
const vscode = require("vscode");
const REFOCUS_COOLDOWN_MS = 5000;
/// When the user dwells on the bottom panel region long enough to fire
/// an AttentionEvent, focus the eri chat composer. Heavy cooldown so we
/// don't thrash if the user is just glancing.
class ChatFocus {
    service;
    subs = [];
    lastFocusAt = 0;
    constructor(service) {
        this.service = service;
        this.subs.push(this.service.onAttention((event) => this.handle(event)));
    }
    isEnabled() {
        return vscode.workspace
            .getConfiguration("eri.gaze")
            .get("chatAutoFocus", true);
    }
    handle(event) {
        if (!this.isEnabled()) {
            return;
        }
        if (event.kind !== "enter" || event.region !== "panel") {
            return;
        }
        const now = Date.now();
        if (now - this.lastFocusAt < REFOCUS_COOLDOWN_MS) {
            return;
        }
        this.lastFocusAt = now;
        void vscode.commands.executeCommand("eri.panel.focus");
    }
    dispose() {
        for (const sub of this.subs) {
            sub.dispose();
        }
        this.subs.length = 0;
    }
}
exports.ChatFocus = ChatFocus;
//# sourceMappingURL=chatFocus.js.map