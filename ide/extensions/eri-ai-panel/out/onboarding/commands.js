"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ONBOARDING_STATE_KEY = void 0;
exports.registerOnboardingCommands = registerOnboardingCommands;
exports.maybeOpenWalkthroughOnStartup = maybeOpenWalkthroughOnStartup;
const vscode = require("vscode");
const ONBOARDED_KEY = "eri.onboarded";
const SIGN_IN_PATH = "/auth/google/start";
const DEFAULT_API_BASE = "https://eri.dev";
const VU_DURATION_MS = 3_000;
const defaultOpener = {
    open: (url) => vscode.env.openExternal(url),
};
function resolveSignInUrl() {
    const config = vscode.workspace.getConfiguration("eri");
    const base = config.get("apiBaseUrl", DEFAULT_API_BASE) || DEFAULT_API_BASE;
    const trimmed = base.replace(/\/+$/, "");
    return vscode.Uri.parse(`${trimmed}${SIGN_IN_PATH}`);
}
function registerOnboardingCommands(deps, opener = defaultOpener) {
    const { context, getSidecar } = deps;
    const openWalkthrough = vscode.commands.registerCommand("eri.openWalkthrough", async () => {
        await vscode.commands.executeCommand("workbench.action.openWalkthrough", "eri.eri-ai-panel#eriOnboarding", false);
    });
    const signIn = vscode.commands.registerCommand("eri.onboarding.signIn", async () => {
        const url = resolveSignInUrl();
        await opener.open(url);
    });
    const skipSignIn = vscode.commands.registerCommand("eri.onboarding.skipSignIn", async () => {
        await context.globalState.update("eri.onboarding.signInSkipped", true);
        void vscode.window.showInformationMessage("eri: signed-in features stay disabled. BYOK still works.");
    });
    const testMic = vscode.commands.registerCommand("eri.onboarding.testMic", async () => {
        await context.globalState.update("eri.onboarding.micTested", true);
        const sidecar = getSidecar();
        if (!sidecar) {
            void vscode.window.showWarningMessage("eri sidecar not running — microphone test deferred.");
            return;
        }
        try {
            sidecar.notify("voice/probe", { durationMs: VU_DURATION_MS });
        }
        catch {
            void vscode.window.showWarningMessage("eri: could not reach the sidecar to probe the mic.");
            return;
        }
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            cancellable: false,
            title: "eri: listening for 3 seconds…",
        }, async (progress) => {
            const steps = 30;
            const interval = VU_DURATION_MS / steps;
            for (let i = 0; i < steps; i += 1) {
                const level = Math.round(40 + 50 * Math.abs(Math.sin(i / 3)));
                progress.report({ message: `${"|".repeat(Math.max(1, Math.round(level / 6)))}` });
                await new Promise((resolve) => setTimeout(resolve, interval));
            }
        });
    });
    const calibrateGaze = vscode.commands.registerCommand("eri.onboarding.calibrateGaze", async () => {
        await context.globalState.update("eri.onboarding.gazeCalibrated", true);
        const sidecar = getSidecar();
        if (!sidecar) {
            void vscode.window.showInformationMessage("eri: gaze calibration coming soon (sidecar offline).");
            return;
        }
        try {
            sidecar.notify("gaze/calibrate", { points: 5 });
            void vscode.window.showInformationMessage("eri: follow the five dots to calibrate gaze.");
        }
        catch {
            void vscode.window.showInformationMessage("eri: gaze calibration coming soon.");
        }
    });
    const skipGaze = vscode.commands.registerCommand("eri.onboarding.skipGaze", async () => {
        await context.globalState.update("eri.onboarding.gazeSkipped", true);
    });
    const openPanel = vscode.commands.registerCommand("eri.onboarding.openPanel", async () => {
        await context.globalState.update(ONBOARDED_KEY, true);
        await vscode.commands.executeCommand("workbench.view.extension.eri-activitybar");
        await vscode.commands.executeCommand("eri.panel.focus").then(undefined, () => undefined);
    });
    return [openWalkthrough, signIn, skipSignIn, testMic, calibrateGaze, skipGaze, openPanel];
}
async function maybeOpenWalkthroughOnStartup(context) {
    if (context.globalState.get(ONBOARDED_KEY) === true) {
        return;
    }
    await vscode.commands.executeCommand("workbench.action.openWalkthrough", "eri.eri-ai-panel#eriOnboarding", false);
}
exports.ONBOARDING_STATE_KEY = ONBOARDED_KEY;
//# sourceMappingURL=commands.js.map