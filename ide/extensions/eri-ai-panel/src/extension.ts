import * as vscode from "vscode";
import { resolveBinaryPath, Sidecar, SidecarNotification } from "./sidecar";
import { EriPanelProvider } from "./panel";
import { PreviewManager } from "./preview";
import { activateTab } from "./tab/tab";
import { activateMentionCompletions } from "./mentions/mentions";
import { activateAtMentions, AtMentionsHandle } from "./at_mentions";
import { activateMcp, applyServerStatus, McpRegistryHandle } from "./mcp/mcpRegistry";
import { McpServerState } from "./mcp/mcpView";
import { activateComposer, ComposerHandle } from "./composer/composer";
import { activateGaze, GazeHandle } from "./gaze/gaze";
import { activateTierClient, TierClientHandle } from "./tier/tierClient";

export { getCurrentTarget as getCurrentGazeTarget, getEditorGazeContext } from "./gaze/gaze";

let sidecar: Sidecar | null = null;
let panelProvider: EriPanelProvider | null = null;
let previewManager: PreviewManager | null = null;
let mcpRegistry: McpRegistryHandle | null = null;
let composer: ComposerHandle | null = null;
let atMentions: AtMentionsHandle | null = null;
let gaze: GazeHandle | null = null;
let tierClient: TierClientHandle | null = null;

export function activate(context: vscode.ExtensionContext): void {
  const binaryPath = resolveBinaryPath(context);

  sidecar = new Sidecar({
    binaryPath,
    onNotification: handleNotification,
    onExit: (code) => {
      console.warn(`[eri] sidecar exited (code=${code})`);
      sidecar = null;
    },
  });
  sidecar.start();

  panelProvider = new EriPanelProvider(context, () => sidecar);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("eri.panel", panelProvider),
  );

  previewManager = new PreviewManager(context);
  context.subscriptions.push(previewManager);

  // Activate tier client right after sidecar starts so the very first
  // setContext + sidecar handshake reflects the user's real tier.
  tierClient = activateTierClient(context, () => sidecar);

  activateTab(context, () => sidecar);
  atMentions = activateAtMentions(context, () => sidecar);
  activateMentionCompletions(context, atMentions.registry);
  mcpRegistry = activateMcp(context, () => sidecar);
  gaze = activateGaze(context, () => sidecar);
  composer = activateComposer(context, () => sidecar, atMentions);

  context.subscriptions.push(
    vscode.commands.registerCommand("eri.openPreview", () => {
      previewManager?.open();
    }),
    vscode.commands.registerCommand("eri.toggleMic", () => {
      sidecar?.notify("eri/voice/toggle", {});
    }),
    vscode.commands.registerCommand("eri.inlineEdit", () => {
      vscode.commands.executeCommand("editor.action.eriInlineEdit").then(undefined, () => {
        vscode.window.showInformationMessage("eri inline edit — widget contribution missing");
      });
    }),
    vscode.commands.registerCommand("eri.openChat", () => {
      vscode.commands.executeCommand("workbench.view.extension.eriPanel");
    }),
    vscode.commands.registerCommand("eri.openComposer", () => {
      composer?.open();
    }),
    vscode.commands.registerCommand("eri.openAgentLayout", () => {
      panelProvider?.postToWebview({ method: "eri/ui/agentLayout", params: {} });
    }),
    vscode.commands.registerCommand("eri.modeMenu", () => {
      panelProvider?.postToWebview({ method: "eri/ui/modeMenu", params: {} });
    }),
    vscode.commands.registerCommand("eri.cycleModel", () => {
      sidecar?.notify("eri/model/cycle", {});
    }),
    vscode.commands.registerCommand("eri.acceptIteration", () => {
      sidecar?.notify("eri/iteration/accept", {});
    }),
    vscode.commands.registerCommand("eri.rejectIteration", () => {
      sidecar?.notify("eri/iteration/reject", {});
    }),
    vscode.commands.registerCommand("eri.stopGeneration", () => {
      sidecar?.notify("eri/inference/cancel", {});
    }),
    vscode.commands.registerCommand("eri.setDiffusionFire", (active: boolean) => {
      vscode.commands.executeCommand("setContext", "eri.diffusionFire", !!active);
    }),
  );
}

export function deactivate(): void {
  sidecar?.stop();
  sidecar = null;
  panelProvider = null;
  previewManager = null;
  mcpRegistry?.dispose();
  mcpRegistry = null;
  composer = null;
  atMentions?.dispose();
  atMentions = null;
  gaze?.dispose();
  gaze = null;
  tierClient?.dispose();
  tierClient = null;
}

function handleNotification(notification: SidecarNotification): void {
  composer?.forward(notification);
  gaze?.forward(notification);
  switch (notification.method) {
    case "eri/ready":
      console.log("[eri] sidecar ready", notification.params);
      break;
    case "eri/voice/partial":
    case "eri/voice/final":
    case "eri/inference/delta":
    case "eri/iteration/recorded":
      panelProvider?.postToWebview(notification);
      break;
    case "eri/inference/started":
      vscode.commands.executeCommand("eri.setDiffusionFire", true);
      break;
    case "eri/inference/done":
    case "eri/inference/cancelled":
      vscode.commands.executeCommand("eri.setDiffusionFire", false);
      break;
    case "eri/preview/open":
      previewManager?.open(
        typeof notification.params === "object" && notification.params
          ? (notification.params as { sessionPath?: string }).sessionPath
          : undefined,
      );
      break;
    case "eri/mcp/serverStatus": {
      const params = notification.params as
        | {
            name?: string;
            state?: string;
            toolCount?: number;
            detail?: string;
          }
        | undefined;
      if (params && typeof params.name === "string" && mcpRegistry) {
        const allowed: ReadonlyArray<McpServerState> = ["online", "offline", "error"];
        const state =
          typeof params.state === "string" && (allowed as ReadonlyArray<string>).includes(params.state)
            ? (params.state as McpServerState)
            : undefined;
        applyServerStatus(mcpRegistry.view, {
          name: params.name,
          ...(state ? { state } : {}),
          ...(typeof params.toolCount === "number" ? { toolCount: params.toolCount } : {}),
          ...(typeof params.detail === "string" ? { detail: params.detail } : {}),
        });
      }
      break;
    }
    default:
      console.debug("[eri] unhandled notification", notification.method);
  }
}
