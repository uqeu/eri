"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GazeStatusBar = void 0;
const vscode = require("vscode");
// Priority 9000 places this just to the right of the mic indicator (which sits
// at 9100 in the eri layout). Higher priority means further left on the bar.
const STATUS_PRIORITY = 9000;
const RECALIBRATE_COMMAND = "eri.gaze.recalibrate";
const DESCRIPTORS = {
    idle: {
        text: "$(eye) gaze",
        tooltip: "eri gaze — waiting for tracker",
        color: new vscode.ThemeColor("descriptionForeground"),
    },
    looking: {
        text: "$(eye) looking",
        tooltip: "eri gaze — tracking active. Click to recalibrate.",
        color: new vscode.ThemeColor("charts.yellow"),
    },
    lost: {
        text: "$(eye-closed) lost",
        tooltip: "eri gaze — tracker can't see your eyes. Click to recalibrate.",
        color: new vscode.ThemeColor("descriptionForeground"),
    },
    calibration: {
        text: "$(eye) cal",
        tooltip: "eri gaze — calibration required. Click to start.",
        background: new vscode.ThemeColor("statusBarItem.warningBackground"),
    },
};
class GazeStatusBar {
    item;
    state = "idle";
    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, STATUS_PRIORITY);
        this.item.command = RECALIBRATE_COMMAND;
        this.applyState();
        this.item.show();
    }
    setState(state) {
        if (this.state === state) {
            return;
        }
        this.state = state;
        this.applyState();
    }
    hide() {
        this.item.hide();
    }
    show() {
        this.item.show();
    }
    dispose() {
        this.item.dispose();
    }
    applyState() {
        const descriptor = DESCRIPTORS[this.state];
        this.item.text = descriptor.text;
        this.item.tooltip = descriptor.tooltip;
        // VSCode requires undefined (not null) to clear these styling fields.
        this.item.color = descriptor.color;
        this.item.backgroundColor = descriptor.background;
    }
}
exports.GazeStatusBar = GazeStatusBar;
//# sourceMappingURL=gazeStatusBar.js.map