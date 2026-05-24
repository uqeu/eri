"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentTarget = getCurrentTarget;
exports.activateGaze = activateGaze;
exports.getEditorGazeContext = getEditorGazeContext;
const vscode = require("vscode");
const chatFocus_1 = require("./chatFocus");
const editorGaze_1 = require("./editorGaze");
const gazeDecoration_1 = require("./gazeDecoration");
const gazeService_1 = require("./gazeService");
const gazeStatusBar_1 = require("./gazeStatusBar");
const previewRelay_1 = require("./previewRelay");
const sidebarGaze_1 = require("./sidebarGaze");
let currentTarget = null;
function getCurrentTarget() {
    return currentTarget;
}
const TARGET_METHODS = new Set([
    "eri/gaze/target",
    "eri/gaze/lost",
    "eri/gaze/calibration/required",
]);
const POINT_METHODS = new Set([
    "eri/gaze/point",
    "eri/gaze/lost",
    "eri/gaze/calibration/required",
]);
const CALIBRATION_STATE_KEY = "eri.gaze.calibrationComplete";
function activateGaze(context, getSidecar) {
    const decoration = new gazeDecoration_1.GazeDecoration();
    const statusBar = new gazeStatusBar_1.GazeStatusBar();
    const dwellMs = vscode.workspace
        .getConfiguration("eri.gaze")
        .get("dwellMs", 800);
    const service = new gazeService_1.GazeService({ getSidecar, dwellMs });
    const editorGaze = new editorGaze_1.EditorGaze(service);
    const sidebarGaze = new sidebarGaze_1.SidebarGaze(service);
    const chatFocus = new chatFocus_1.ChatFocus(service);
    const previewRelay = new previewRelay_1.PreviewRelay(service, getSidecar);
    const editorChangeSub = vscode.window.onDidChangeActiveTextEditor(() => {
        decoration.refreshForActiveEditor();
    });
    const configChangeSub = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("eri.gaze.enabled")) {
            if (!isFeatureEnabled()) {
                currentTarget = null;
                decoration.clear();
                statusBar.hide();
                void service.stop();
            }
            else {
                statusBar.show();
                if (autoStart()) {
                    void service.start();
                }
            }
        }
        if (event.affectsConfiguration("eri.gaze.decorationsEnabled")) {
            if (currentTarget?.kind === "editor" && typeof currentTarget.line === "number") {
                decoration.showLine(currentTarget.line);
            }
            else {
                decoration.clear();
            }
        }
    });
    // Status bar visualisation hooks: status bar lights up when we get
    // points; calms down when the tracker goes quiet.
    const onGazeSub = service.onGaze((point) => {
        statusBar.setState("looking");
        // Mirror the continuous point into the legacy target API so
        // existing consumers see "an editor target" without a sidecar emit.
        syncTargetFromPoint(point, decoration);
    });
    const recalibrateCmd = vscode.commands.registerCommand("eri.gaze.recalibrate", async () => {
        const sidecar = getSidecar();
        if (!sidecar) {
            vscode.window.showWarningMessage("eri gaze — sidecar offline, can't recalibrate");
            return;
        }
        try {
            await sidecar.request("eri/gaze/calibrate", {});
            await context.globalState.update(CALIBRATION_STATE_KEY, true);
            vscode.window.setStatusBarMessage("eri gaze — recalibration complete", 2000);
        }
        catch (err) {
            console.warn("[eri-gaze] calibration failed", err);
            vscode.window.setStatusBarMessage("eri gaze — calibration failed", 2000);
        }
    });
    const toggleCmd = vscode.commands.registerCommand("eri.gaze.toggle", async () => {
        const config = vscode.workspace.getConfiguration("eri.gaze");
        const next = !config.get("enabled", true);
        await config.update("enabled", next, vscode.ConfigurationTarget.Global);
        vscode.window.setStatusBarMessage(`eri gaze — ${next ? "enabled" : "disabled"}`, 2000);
    });
    const pauseCmd = vscode.commands.registerCommand("eri.gaze.pause", async () => {
        await service.stop();
        statusBar.setState("lost");
        vscode.window.setStatusBarMessage("eri gaze — paused", 2000);
    });
    const resumeCmd = vscode.commands.registerCommand("eri.gaze.resume", async () => {
        await service.start();
        vscode.window.setStatusBarMessage("eri gaze — resumed", 2000);
    });
    const toggleHighlightCmd = vscode.commands.registerCommand("eri.gaze.toggleEditorHighlight", async () => {
        const config = vscode.workspace.getConfiguration("eri.gaze");
        const next = !config.get("editorHighlight", true);
        await config.update("editorHighlight", next, vscode.ConfigurationTarget.Global);
        vscode.window.setStatusBarMessage(`eri gaze — editor highlight ${next ? "on" : "off"}`, 2000);
    });
    context.subscriptions.push(editorChangeSub, configChangeSub, recalibrateCmd, toggleCmd, pauseCmd, resumeCmd, toggleHighlightCmd, onGazeSub);
    if (!isFeatureEnabled()) {
        statusBar.hide();
    }
    else if (autoStart()) {
        // Fire-and-forget. Camera permission rejection surfaces as a sidecar
        // error which we already log on the Rust side.
        void (async () => {
            const calibrated = context.globalState.get(CALIBRATION_STATE_KEY, false);
            if (!calibrated) {
                try {
                    const sidecar = getSidecar();
                    if (sidecar) {
                        await sidecar.request("eri/gaze/calibrate", {});
                        await context.globalState.update(CALIBRATION_STATE_KEY, true);
                    }
                }
                catch (err) {
                    console.warn("[eri-gaze] initial calibrate failed", err);
                }
            }
            await service.start();
        })();
    }
    const handle = {
        getCurrentTarget: () => currentTarget,
        isEnabled: isFeatureEnabled,
        service: () => service,
        forward(notification) {
            if (POINT_METHODS.has(notification.method) && isFeatureEnabled()) {
                service.forward(notification);
            }
            if (!TARGET_METHODS.has(notification.method)) {
                return;
            }
            if (!isFeatureEnabled()) {
                return;
            }
            handleLegacyTargetNotification(notification, decoration, statusBar);
        },
        dispose() {
            decoration.dispose();
            statusBar.dispose();
            editorGaze.dispose();
            sidebarGaze.dispose();
            chatFocus.dispose();
            previewRelay.dispose();
            service.dispose();
            currentTarget = null;
        },
    };
    context.subscriptions.push({ dispose: () => handle.dispose() });
    return handle;
}
function handleLegacyTargetNotification(notification, decoration, statusBar) {
    switch (notification.method) {
        case "eri/gaze/target": {
            const target = parseLegacyTarget(notification.params);
            if (!target) {
                return;
            }
            currentTarget = target;
            statusBar.setState("looking");
            if (target.kind === "editor" && typeof target.line === "number") {
                decoration.showLine(target.line);
            }
            else {
                decoration.clear();
            }
            break;
        }
        case "eri/gaze/lost":
            currentTarget = null;
            decoration.clear();
            statusBar.setState("lost");
            break;
        case "eri/gaze/calibration/required":
            currentTarget = null;
            decoration.clear();
            statusBar.setState("calibration");
            break;
        default:
            break;
    }
}
function syncTargetFromPoint(point, decoration) {
    // Only synthesise an editor target when the point is in the editor
    // region; otherwise leave the legacy `currentTarget` untouched.
    if (point.x < 0.18 || point.x > 0.82 || point.y > 0.7) {
        return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    const visible = editor.visibleRanges[0];
    if (!visible) {
        return;
    }
    const span = Math.max(0, visible.end.line - visible.start.line);
    const normalized = Math.max(0, Math.min(1, (point.y - 0.05) / (0.7 - 0.05)));
    const line = Math.min(visible.end.line, Math.max(visible.start.line, Math.floor(visible.start.line + normalized * span)));
    const next = {
        kind: "editor",
        line,
        column: 0,
        uri: editor.document.uri.toString(),
        receivedAt: Date.now(),
    };
    currentTarget = next;
    if (vscode.workspace.getConfiguration("eri.gaze").get("decorationsEnabled", true)) {
        decoration.showLine(line);
    }
}
function parseLegacyTarget(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const params = raw;
    const kind = params.kind;
    if (kind !== "editor" && kind !== "panel" && kind !== "preview") {
        return null;
    }
    const target = {
        kind,
        receivedAt: Date.now(),
    };
    if (typeof params.line === "number" && Number.isFinite(params.line) && params.line >= 0) {
        target.line = Math.floor(params.line);
    }
    if (typeof params.column === "number" && Number.isFinite(params.column) && params.column >= 0) {
        target.column = Math.floor(params.column);
    }
    if (typeof params.elementId === "string") {
        target.elementId = params.elementId;
    }
    if (typeof params.uri === "string") {
        target.uri = params.uri;
    }
    else if (kind === "editor") {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            target.uri = editor.document.uri.toString();
        }
    }
    return target;
}
function isFeatureEnabled() {
    return vscode.workspace
        .getConfiguration("eri.gaze")
        .get("enabled", true);
}
function autoStart() {
    return vscode.workspace
        .getConfiguration("eri.gaze")
        .get("autoStart", true);
}
function getEditorGazeContext() {
    if (!currentTarget || currentTarget.kind !== "editor") {
        return null;
    }
    if (typeof currentTarget.line !== "number") {
        return null;
    }
    const uri = currentTarget.uri ?? vscode.window.activeTextEditor?.document.uri.toString();
    if (!uri) {
        return null;
    }
    const radius = vscode.workspace
        .getConfiguration("eri.gaze")
        .get("contextRadius", 5);
    return {
        uri,
        line: currentTarget.line,
        column: currentTarget.column ?? 0,
        radius: Math.max(0, Math.floor(radius)),
    };
}
//# sourceMappingURL=gaze.js.map