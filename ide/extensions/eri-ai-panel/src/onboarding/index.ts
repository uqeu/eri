import * as vscode from "vscode";
import type { Sidecar } from "../sidecar";
import {
  maybeOpenWalkthroughOnStartup,
  registerOnboardingCommands,
  ONBOARDING_STATE_KEY,
} from "./commands";

const STARTUP_DELAY_MS = 1_500;

export interface OnboardingHandle {
  readonly dispose: () => void;
}

/**
 * Wires up the eri onboarding walkthrough — registers commands, and on first
 * activation (when `eri.onboarded` is not yet true) opens the walkthrough after
 * a short delay so the rest of the extension can finish booting first.
 */
export function activateOnboarding(
  context: vscode.ExtensionContext,
  getSidecar: () => Sidecar | null,
): OnboardingHandle {
  const disposables = registerOnboardingCommands({ context, getSidecar });
  for (const d of disposables) {
    context.subscriptions.push(d);
  }

  const alreadyOnboarded = context.globalState.get<boolean>(ONBOARDING_STATE_KEY, false);
  let startupTimer: NodeJS.Timeout | undefined;
  if (!alreadyOnboarded) {
    startupTimer = setTimeout(() => {
      void maybeOpenWalkthroughOnStartup(context);
    }, STARTUP_DELAY_MS);
  }

  const handle: OnboardingHandle = {
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

export { ONBOARDING_STATE_KEY } from "./commands";
