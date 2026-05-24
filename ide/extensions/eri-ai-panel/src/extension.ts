import * as vscode from "vscode";
import {
  resolveBinaryPath,
  Sidecar,
  SidecarIncomingRequest,
  SidecarNotification,
} from "./sidecar";
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
import { activateCheckpoints, CheckpointsHandle } from "./checkpoints";
import { activateApply, ApplyHandle } from "./apply";
import { activateSkills, SkillsHandle } from "./skills";
import { activateHooks, HooksHandle } from "./hooks";
import { SecretsStore } from "./settings/secrets";
import { ByokSettingsView, BYOK_VIEW_ID } from "./settings/settingsView";
import {
  SECRET_REQUEST_METHOD,
  handleSecretRequest,
} from "./settings/sidecarBridge";
import { activateOnboarding, OnboardingHandle } from "./onboarding";
import { activateSettingsHub, SettingsHubHandle } from "./settingsHub";
import { activateCodemaps, CodemapsHandle } from "./codemaps";
import { activateGraph, GraphHandle } from "./graph";
import { activateTerminalVoiceGaze, TerminalVoiceGazeHandle } from "./terminals";
import { activateMcpPresets, McpPresetsHandle } from "./mcpPresets";
import { activateAudit, AuditHandle } from "./audit";
import { activateCrash, CrashHandle } from "./crash";
import { activateVisualEditor, VisualEditorHandle } from "./visualEditor";
import { activateReview, ReviewHandle } from "./review";

export { getCurrentTarget as getCurrentGazeTarget, getEditorGazeContext } from "./gaze/gaze";

let sidecar: Sidecar | null = null;
let panelProvider: EriPanelProvider | null = null;
let previewManager: PreviewManager | null = null;
let mcpRegistry: McpRegistryHandle | null = null;
let composer: ComposerHandle | null = null;
let atMentions: AtMentionsHandle | null = null;
let gaze: GazeHandle | null = null;
let tierClient: TierClientHandle | null = null;
let checkpoints: CheckpointsHandle | null = null;
let apply: ApplyHandle | null = null;
let skills: SkillsHandle | null = null;
let byokView: ByokSettingsView | null = null;
let secretsStore: SecretsStore | null = null;
let onboarding: OnboardingHandle | null = null;
let settingsHub: SettingsHubHandle | null = null;
let codemaps: CodemapsHandle | null = null;
let graph: GraphHandle | null = null;
let terminalVoiceGaze: TerminalVoiceGazeHandle | null = null;
let mcpPresets: McpPresetsHandle | null = null;
let hooks: HooksHandle | null = null;
let audit: AuditHandle | null = null;
let crash: CrashHandle | null = null;
let visualEditor: VisualEditorHandle | null = null;
let review: ReviewHandle | null = null;

export function activate(context: vscode.ExtensionContext): void {
  const binaryPath = resolveBinaryPath(context);

  secretsStore = new SecretsStore(context.secrets, context.globalState);
  const localSecrets = secretsStore;

  sidecar = new Sidecar({
    binaryPath,
    onNotification: handleNotification,
    onExit: (code) => {
      console.warn(`[eri] sidecar exited (code=${code})`);
      sidecar = null;
    },
    onRequest: async (request: SidecarIncomingRequest): Promise<unknown> => {
      if (request.method === SECRET_REQUEST_METHOD) {
        return handleSecretRequest(request, localSecrets);
      }
      throw new Error("method not found");
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
  checkpoints = activateCheckpoints(context, () => sidecar);
  apply = activateApply(context, () => sidecar);
  skills = activateSkills(context, () => sidecar);
  onboarding = activateOnboarding(context, () => sidecar);
  settingsHub = activateSettingsHub(context);
  codemaps = activateCodemaps(context, () => sidecar);
  graph = activateGraph(context, () => sidecar);
  terminalVoiceGaze = activateTerminalVoiceGaze(context, () => sidecar);
  review = activateReview(context, () => sidecar);
  mcpPresets = activateMcpPresets(context);
  hooks = activateHooks(context, () => sidecar);
  audit = activateAudit(context, () => sidecar);
  crash = activateCrash(context, () => sidecar);
  visualEditor = activateVisualEditor(context, () => sidecar);

  byokView = new ByokSettingsView(context, secretsStore);
  const localView = byokView;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(BYOK_VIEW_ID, byokView),
    vscode.commands.registerCommand("eri.byok.setKey", async () => {
      await localView.pickAndSet();
    }),
    vscode.commands.registerCommand("eri.byok.clearAll", async () => {
      await localView.clearAll();
    }),
    vscode.commands.registerCommand("eri.settings.open", async () => {
      await vscode.commands.executeCommand(
        "workbench.view.extension.eri-activitybar",
      );
      await vscode.commands.executeCommand(`${BYOK_VIEW_ID}.focus`);
    }),
  );

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
      // Reveal the eri activity-bar container and focus the chat view inside it.
      vscode.commands.executeCommand("workbench.view.extension.eri-activitybar").then(
        () => vscode.commands.executeCommand("eri.panel.focus"),
        () => undefined,
      );
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
  checkpoints?.dispose();
  checkpoints = null;
  apply?.dispose();
  apply = null;
  skills?.dispose();
  skills = null;
  hooks?.dispose();
  hooks = null;
  onboarding?.dispose();
  onboarding = null;
  settingsHub?.dispose();
  settingsHub = null;
  codemaps?.dispose();
  codemaps = null;
  graph?.dispose();
  graph = null;
  terminalVoiceGaze?.dispose();
  terminalVoiceGaze = null;
  mcpPresets?.dispose();
  mcpPresets = null;
  audit?.dispose();
  audit = null;
  crash?.dispose();
  crash = null;
  visualEditor?.dispose();
  visualEditor = null;
  review?.dispose();
  review = null;
  byokView = null;
  secretsStore = null;
}

function handleNotification(notification: SidecarNotification): void {
  composer?.forward(notification);
  gaze?.forward(notification);
  terminalVoiceGaze?.forward(notification);
  visualEditor?.forward(notification);
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
