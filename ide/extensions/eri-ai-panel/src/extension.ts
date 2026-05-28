import * as vscode from "vscode";
import {
  resolveBinaryPath,
  Sidecar,
  SidecarIncomingRequest,
  SidecarNotification,
} from "./sidecar";
import { EriPanelProvider } from "./panel";
import { activatePreview, PreviewHandle } from "./preview";
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
import { activateStatusBar, EriStatusBarHandle } from "./statusBar";
import { activateAccount, AccountHandle } from "./account";
import { activateAgents, AgentsHandle } from "./agents";
import { activateJanitorRulesWatcher } from "./background/janitorRulesWatcher";
import { activateShip, ShipHandle } from "./ship";
import { activateSlashRegistry, SlashRegistryHandle } from "./slash/registry";
import { activateSnippets, SnippetsHandle } from "./snippets";
import { LayoutManager, applyModeSideEffects, applyChatPosition } from "./layout/layoutManager";
import { LAYOUT_VIEW_ID, LayoutSettingsViewProvider } from "./layout/layoutSettingsView";
import { createPreviewSurfaceCoordinator, PreviewSurfaceCoordinator } from "./preview/surfaceCoordinator";
import { tryDispatchViewIntent } from "./terminals/intentDispatcher";
import { registerThemeHub } from "./theme/themeHub";
import { activatePhase25Onboarding } from "./onboarding/phase25";

export { getCurrentTarget as getCurrentGazeTarget, getEditorGazeContext } from "./gaze/gaze";

let sidecar: Sidecar | null = null;
let panelProvider: EriPanelProvider | null = null;
let preview: PreviewHandle | null = null;
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
let statusBar: EriStatusBarHandle | null = null;
let account: AccountHandle | null = null;
let agents: AgentsHandle | null = null;
let ship: ShipHandle | null = null;
let slashRegistry: SlashRegistryHandle | null = null;
let snippets: SnippetsHandle | null = null;

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

  statusBar = activateStatusBar(context);
  account = activateAccount(context, { getSidecar: () => sidecar });

  agents = activateAgents(context, {
    secrets: secretsStore,
    session: account.store,
    getSidecar: () => sidecar,
    onActiveChanged: (descriptor) => {
      panelProvider?.postToWebview({
        method: "eri/agents/active",
        params: { id: descriptor.id, label: descriptor.label, kind: descriptor.kind, free: descriptor.free },
      });
    },
  });

  panelProvider = new EriPanelProvider(context, () => sidecar);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("eri.panel", panelProvider),
  );

  preview = activatePreview(context, () => sidecar);

  // Layout manager owns mode + chat position + preview surface choice;
  // the preview surface coordinator routes preview lifecycle between the
  // Swift window (coder mode) and the embedded WebviewPanel (eri mode).
  const layoutManager = new LayoutManager();
  context.subscriptions.push({ dispose: () => layoutManager.dispose() });
  const previewCoordinator: PreviewSurfaceCoordinator = createPreviewSurfaceCoordinator(
    context,
    preview,
    layoutManager,
  );
  const layoutSettingsView = new LayoutSettingsViewProvider(layoutManager);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(LAYOUT_VIEW_ID, layoutSettingsView),
    { dispose: () => layoutSettingsView.dispose() },
  );
  registerThemeHub(context, () => sidecar);
  activatePhase25Onboarding(context);

  // When the preview auto-open path (FS watcher / dev-server detect) fires
  // a `shouldOpen` URL, route it through the surface coordinator so
  // eri-mode opens the embedded WebviewPanel rather than the Swift window.
  context.subscriptions.push(
    preview.onShouldOpen((url) => void previewCoordinator.open(url)),
  );
  // Mode-flip + chat-position side effects (explorer visibility, sidebar
  // location, bottom-panel relocation) are best-effort.
  let lastChatPosition = layoutManager.current().chatPosition;
  context.subscriptions.push(
    layoutManager.onChange((state) => {
      void applyModeSideEffects(state);
      if (state.chatPosition !== lastChatPosition) {
        lastChatPosition = state.chatPosition;
        void applyChatPosition(state.chatPosition);
      }
    }),
  );

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

  // Phase 17a — opt-in event-triggered Janitor rules. The watcher
  // consults `.eri/janitor.json` and fires the configured slash
  // commands on matching save events. Disabled unless the user flips
  // `eri.background.rulesEnabled`.
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    context.subscriptions.push(
      activateJanitorRulesWatcher(context, {
        workspaceRoot,
        getSidecar: () => sidecar,
      }),
    );
  }

  // Phase 23 — onboarding modal. Fires on first sign-in via the
  // session listener below; can also be run manually via the command
  // palette ("eri: Run onboarding").
  context.subscriptions.push(
    vscode.commands.registerCommand("eri.onboarding.run", async () => {
      const { runOnboarding } = await import("./onboarding/buildStyleQuestions");
      const result = await runOnboarding();
      if (!result) return;
      vscode.window.showInformationMessage(
        `eri — preferences written to ${result.preferencesPath}.`,
      );
      if (result.themeSuggestion) {
        await vscode.commands.executeCommand(
          "eri.themes.setActive",
          { slug: result.themeSuggestion },
        );
      }
    }),
  );
  // First-time fire — flips a globalState flag so we never prompt twice.
  context.subscriptions.push(
    account.store.onChange((session) => {
      if (!session) return;
      const flag = "eri.onboarding.completedV1";
      if (context.globalState.get<boolean>(flag)) return;
      void context.globalState.update(flag, true);
      void vscode.commands.executeCommand("eri.onboarding.run");
    }),
  );

  // Phase 21b — `/document <path-or-url>` command. Reads a local file
  // or downloads an HTTP target, extracts text (PDFs get heuristic
  // parsing; everything else is read as UTF-8), opens a paginated
  // markdown summary the user can chat against.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "eri.document.run",
      async (args?: { target?: string }) => {
        const target =
          args?.target ??
          (await vscode.window.showInputBox({
            prompt: "/document — paste a file path or URL",
            placeHolder: "./paper.pdf or https://arxiv.org/abs/...",
            ignoreFocusOut: true,
          }));
        if (!target) return;
        try {
          const { runDocument, showDocumentResult } = await import("./document");
          const result = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `eri /document — extracting ${target}…`,
              cancellable: false,
            },
            () => runDocument({ target }),
          );
          await showDocumentResult(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`eri /document failed: ${msg}`);
        }
      },
    ),
  );

  // Phase 21a — `/tracer <github-url> <query>` command. Clones a
  // remote repo into ~/.eri/sandboxes/<sha>/, indexes it, runs a
  // search, opens the markdown report. Tear-down happens when the
  // user dismisses the result document.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "eri.tracer.run",
      async (args?: { url?: string; query?: string }) => {
        const sc = sidecar;
        if (!sc) {
          vscode.window.showWarningMessage(
            "eri /tracer — sidecar not running.",
          );
          return;
        }
        const { runTracer, showTracerResultDocument, parseTracerArgs } =
          await import("./tracer");
        let url = args?.url;
        let query = args?.query;
        if (!url || !query) {
          const free = await vscode.window.showInputBox({
            prompt: "/tracer — paste `<github-url> <query>`",
            placeHolder: "https://github.com/anthropics/anthropic-sdk-python how does streaming work?",
            ignoreFocusOut: true,
          });
          if (!free) return;
          const parsed = parseTracerArgs(free);
          if (!parsed) {
            vscode.window.showWarningMessage(
              "Provide both a URL and a query.",
            );
            return;
          }
          url = parsed.url;
          query = parsed.query;
        }
        try {
          const result = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `eri /tracer — cloning + indexing ${url}…`,
              cancellable: false,
            },
            () => runTracer({ url: url!, query: query!, sidecar: sc }),
          );
          await showTracerResultDocument(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`eri /tracer failed: ${msg}`);
        }
      },
    ),
  );
  // Auto-open the Swift preview window whenever an iteration applies an
  // `index.html` build. Gated by `eri.preview.autoOpenOnBuild`. The hook
  // looks at the apply orchestrator's `committed` event, which is the only
  // signal we have post-disk-write that doesn't require a sidecar push.
  context.subscriptions.push(
    apply.onDidChange((event) => {
      if (event.kind !== "committed") {
        return;
      }
      const autoOpen = vscode.workspace
        .getConfiguration("eri.preview")
        .get<boolean>("autoOpenOnBuild", true);
      if (!autoOpen) {
        return;
      }
      const built = (event.result?.applied ?? []).find((a) =>
        a.path.toLowerCase().endsWith("index.html"),
      );
      if (!built) {
        return;
      }
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        return;
      }
      const url = vscode.Uri.joinPath(folder.uri, built.path).toString();
      preview?.fireShouldOpen(url);
    }),
  );
  skills = activateSkills(context, () => sidecar);
  // Ship activates after `apply` so the orchestrator is available, and after
  // `account` so the tier gate is wired. Progress goes straight to the panel
  // webview as `eri/ship/progress` messages.
  slashRegistry = activateSlashRegistry(context, () => sidecar);
  void slashRegistry;
  snippets = activateSnippets(context);
  void snippets;
  ship = activateShip(context, {
    getSidecar: () => sidecar,
    applyOrchestrator: apply.orchestrator,
    account,
    onProgress: (state) => {
      panelProvider?.postToWebview({
        method: "eri/ship/progress",
        params: state,
      });
    },
  });
  onboarding = activateOnboarding(context, () => sidecar);
  settingsHub = activateSettingsHub(context);
  codemaps = activateCodemaps(context, () => sidecar);
  graph = activateGraph(context, () => sidecar);
  terminalVoiceGaze = activateTerminalVoiceGaze(context, () => sidecar, async (transcript) =>
    tryDispatchViewIntent(transcript, {
      previewCoordinator,
      getSidecar: () => sidecar,
      layout: layoutManager,
    }),
  );
  review = activateReview(context, () => sidecar);
  mcpPresets = activateMcpPresets(context);
  hooks = activateHooks(context, () => sidecar);
  audit = activateAudit(context, () => sidecar);
  crash = activateCrash(context, () => sidecar);
  visualEditor = activateVisualEditor(context, () => sidecar);

  // Surface an "you're signed in to eri" banner in the BYOK view so users
  // understand the precedence (BYOK key overrides eri's tier).
  const bannerEmitter = new vscode.EventEmitter<void>();
  const accountCapture = account;
  if (accountCapture) {
    context.subscriptions.push(
      accountCapture.store.onChange(() => bannerEmitter.fire()),
      accountCapture.usage.onUsage(() => bannerEmitter.fire()),
      bannerEmitter,
    );
  }
  const accountBanner = {
    getBanner: (): { email: string; tierLabel: string } | null => {
      const session = accountCapture?.store.current() ?? null;
      if (!session) return null;
      // Pull labels from the canonical TIER_LABELS map so the BYOK banner
      // stays in sync with the rest of the IDE (status bar, status webview).
      // No local fallback table — drift between this file and types.ts is
      // exactly the bug we fixed when we moved to backend slugs.
      const label =
        require("./account/types").TIER_LABELS[session.tier] ?? "Free";
      return { email: session.email, tierLabel: label };
    },
    onChange: bannerEmitter.event,
  };
  byokView = new ByokSettingsView(context, secretsStore, accountBanner);
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
      vscode.commands.executeCommand("eri.preview.open");
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
    vscode.commands.registerCommand("eri.openAgentLayout", async () => {
      // Cmd+E entrypoint — historically a stub. Now flips between coder
      // and eri mode via LayoutManager; the panel keeps its previous
      // notification for the inline UI affordance.
      panelProvider?.postToWebview({ method: "eri/ui/agentLayout", params: {} });
      const next = layoutManager.current().mode === "coder" ? "eri" : "coder";
      await layoutManager.setMode(next);
    }),
    vscode.commands.registerCommand("eri.modeMenu", async () => {
      panelProvider?.postToWebview({ method: "eri/ui/modeMenu", params: {} });
      const pick = await vscode.window.showQuickPick(
        [
          { label: "$(layout) Coder mode",  value: "coder" as const },
          { label: "$(sparkle) eri mode",    value: "eri" as const   },
        ],
        { placeHolder: "Switch layout mode" },
      );
      if (pick) await layoutManager.setMode(pick.value);
    }),
    vscode.commands.registerCommand("eri.layout.toggleMode", async () => {
      const next = layoutManager.current().mode === "coder" ? "eri" : "coder";
      await layoutManager.setMode(next);
    }),
    vscode.commands.registerCommand("eri.layout.setChatPosition", async (pos?: string) => {
      const value = pos
        ?? (
          await vscode.window.showQuickPick(
            [
              { label: "Left",   value: "left" as const   },
              { label: "Right",  value: "right" as const  },
              { label: "Bottom", value: "bottom" as const },
            ],
            { placeHolder: "Where should the eri chat panel dock?" },
          )
        )?.value;
      if (value === "left" || value === "right" || value === "bottom") {
        await layoutManager.setChatPosition(value);
      }
    }),
    vscode.commands.registerCommand("eri.layout.openSettings", async () => {
      await vscode.commands.executeCommand(
        "workbench.view.extension.eri-activitybar",
      );
      await vscode.commands.executeCommand("eri.layoutSettings.focus");
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
  preview?.dispose();
  preview = null;
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
  statusBar?.dispose();
  statusBar = null;
  account?.dispose();
  account = null;
  agents?.dispose();
  agents = null;
  ship?.dispose();
  ship = null;
  slashRegistry?.dispose();
  slashRegistry = null;
  snippets?.dispose();
  snippets = null;
  byokView = null;
  secretsStore = null;
}

function handleNotification(notification: SidecarNotification): void {
  composer?.forward(notification);
  gaze?.forward(notification);
  terminalVoiceGaze?.forward(notification);
  visualEditor?.forward(notification);
  ship?.forward(notification);
  maybeRelayGazeToPreview(notification);
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
      statusBar?.setState({ kind: "thinking" });
      break;
    case "eri/inference/done":
    case "eri/inference/cancelled":
      vscode.commands.executeCommand("eri.setDiffusionFire", false);
      statusBar?.setState({ kind: "idle" });
      break;
    case "eri/sidecar/state": {
      // Sidecar broadcasts coarse runtime state for the status bar item.
      // Params shape: { kind: "idle"|"listening"|"thinking"|"gazing"|"error", line?: number, message?: string }
      const params = notification.params as
        | {
            kind?: string;
            line?: number;
            message?: string;
          }
        | undefined;
      if (params && typeof params.kind === "string" && statusBar) {
        switch (params.kind) {
          case "idle":
            statusBar.setState({ kind: "idle" });
            break;
          case "listening":
            statusBar.setState({ kind: "listening" });
            break;
          case "thinking":
            statusBar.setState({ kind: "thinking" });
            break;
          case "gazing":
            statusBar.setState(
              typeof params.line === "number"
                ? { kind: "gazing", line: params.line }
                : { kind: "gazing" },
            );
            break;
          case "error":
            statusBar.setState({
              kind: "error",
              message: typeof params.message === "string" ? params.message : "unknown",
            });
            break;
          default:
            // unknown kind — keep current state
            break;
        }
      }
      break;
    }
    case "eri/preview/open": {
      const params =
        typeof notification.params === "object" && notification.params
          ? (notification.params as { url?: string; sessionPath?: string })
          : {};
      const url = params.url ?? deriveUrlFromSessionPath(params.sessionPath);
      if (url) {
        preview?.fireShouldOpen(url);
      }
      break;
    }
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

function maybeRelayGazeToPreview(notification: SidecarNotification): void {
  if (notification.method !== "eri/gaze/target") {
    return;
  }
  const relayEnabled = vscode.workspace
    .getConfiguration("eri.preview")
    .get<boolean>("gazeRelay", true);
  if (!relayEnabled) {
    return;
  }
  if (!notification.params || typeof notification.params !== "object") {
    return;
  }
  const params = notification.params as Record<string, unknown>;
  if (params.kind !== "preview") {
    return;
  }
  const x = typeof params.x === "number" ? params.x : null;
  const y = typeof params.y === "number" ? params.y : null;
  if (x === null || y === null) {
    return;
  }
  preview?.client.relayGaze(x, y);
}

function deriveUrlFromSessionPath(sessionPath: string | undefined): string | null {
  if (!sessionPath || sessionPath === "") {
    return null;
  }
  return vscode.Uri.file(sessionPath + "/index.html").toString();
}
