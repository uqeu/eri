"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ONBOARDING_STATE_KEY = void 0;
exports.activateOnboarding = activateOnboarding;
const commands_1 = require("./commands");
const STARTUP_DELAY_MS = 1_500;
/**
 * Wires up the eri onboarding walkthrough — registers commands, and on first
 * activation (when `eri.onboarded` is not yet true) opens the walkthrough after
 * a short delay so the rest of the extension can finish booting first.
 */
function activateOnboarding(context, getSidecar) {
    const disposables = (0, commands_1.registerOnboardingCommands)({ context, getSidecar });
    for (const d of disposables) {
        context.subscriptions.push(d);
    }
    const alreadyOnboarded = context.globalState.get(commands_1.ONBOARDING_STATE_KEY, false);
    let startupTimer;
    if (!alreadyOnboarded) {
        startupTimer = setTimeout(() => {
            void (0, commands_1.maybeOpenWalkthroughOnStartup)(context);
        }, STARTUP_DELAY_MS);
    }
    const handle = {
        dispose: () => {
            if (startupTimer) {
                clearTimeout(startupTimer);
                startupTimer = undefined;
            }
        },
    };
    context.subscriptions.push({ dispose: handle.dispose });
    return handle;
}
var commands_2 = require("./commands");
Object.defineProperty(exports, "ONBOARDING_STATE_KEY", { enumerable: true, get: function () { return commands_2.ONBOARDING_STATE_KEY; } });
//# sourceMappingURL=index.js.map