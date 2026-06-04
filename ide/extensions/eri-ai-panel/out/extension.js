"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEditorGazeContext = exports.getCurrentGazeTarget = void 0;
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const sidecar_1 = require("./sidecar");
const panel_1 = require("./panel");
const preview_1 = require("./preview");
const tab_1 = require("./tab/tab");
const mentions_1 = require("./mentions/mentions");
const at_mentions_1 = require("./at_mentions");
const mcpRegistry_1 = require("./mcp/mcpRegistry");
const composer_1 = require("./composer/composer");
const gaze_1 = require("./gaze/gaze");
const gazeNarration_1 = require("./voice/gazeNarration");
const tierClient_1 = require("./tier/tierClient");
const checkpoints_1 = require("./checkpoints");
const apply_1 = require("./apply");
const skills_1 = require("./skills");
const hooks_1 = require("./hooks");
const secrets_1 = require("./settings/secrets");
const settingsView_1 = require("./settings/settingsView");
const sidecarBridge_1 = require("./settings/sidecarBridge");
const onboarding_1 = require("./onboarding");
const settingsHub_1 = require("./settingsHub");
const codemaps_1 = require("./codemaps");
const graph_1 = require("./graph");
const terminals_1 = require("./terminals");
const mcpPresets_1 = require("./mcpPresets");
const audit_1 = require("./audit");
const crash_1 = require("./crash");
const visualEditor_1 = require("./visualEditor");
const review_1 = require("./review");
const statusBar_1 = require("./statusBar");
const account_1 = require("./account");
const agents_1 = require("./agents");
const janitorRulesWatcher_1 = require("./background/janitorRulesWatcher");
const ship_1 = require("./ship");
const registry_1 = require("./slash/registry");
const snippets_1 = require("./snippets");
const layoutManager_1 = require("./layout/layoutManager");
const layoutSettingsView_1 = require("./layout/layoutSettingsView");
const surfaceCoordinator_1 = require("./preview/surfaceCoordinator");
const intentDispatcher_1 = require("./terminals/intentDispatcher");
const voiceRouter_1 = require("./terminals/voiceRouter");
const themeHub_1 = require("./theme/themeHub");
const phase25_1 = require("./onboarding/phase25");
const workbench_1 = require("./workbench");
const agentWorkbenchShell_1 = require("./shell/agentWorkbenchShell");
var gaze_2 = require("./gaze/gaze");
Object.defineProperty(exports, "getCurrentGazeTarget", { enumerable: true, get: function () { return gaze_2.getCurrentTarget; } });
Object.defineProperty(exports, "getEditorGazeContext", { enumerable: true, get: function () { return gaze_2.getEditorGazeContext; } });
let sidecar = null;
let panelProvider = null;
let preview = null;
let mcpRegistry = null;
let composer = null;
let atMentions = null;
let gaze = null;
let gazeNarration = null;
let tierClient = null;
let checkpoints = null;
let apply = null;
let skills = null;
let byokView = null;
let secretsStore = null;
let onboarding = null;
let settingsHub = null;
let codemaps = null;
let graph = null;
let terminalVoiceGaze = null;
let mcpPresets = null;
let hooks = null;
let audit = null;
let crash = null;
let visualEditor = null;
let review = null;
let statusBar = null;
let account = null;
let agents = null;
let ship = null;
let slashRegistry = null;
let snippets = null;
function activate(context) {
    const binaryPath = (0, sidecar_1.resolveBinaryPath)(context);
    secretsStore = new secrets_1.SecretsStore(context.secrets, context.globalState);
    const localSecrets = secretsStore;
    sidecar = new sidecar_1.Sidecar({
        binaryPath,
        onNotification: handleNotification,
        onExit: (code) => {
            console.warn(`[eri] sidecar exited (code=${code})`);
            sidecar = null;
        },
        onRequest: async (request) => {
            if (request.method === sidecarBridge_1.SECRET_REQUEST_METHOD) {
                return (0, sidecarBridge_1.handleSecretRequest)(request, localSecrets);
            }
            throw new Error("method not found");
        },
    });
    sidecar.start();
    panelProvider = new panel_1.EriPanelProvider(context, () => sidecar);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider("eri.panel", panelProvider));
    (0, workbench_1.activateWorkbench)(context, { getSidecar: () => sidecar });
    (0, agentWorkbenchShell_1.activateAgentWorkbenchShell)(context);
    context.subscriptions.push((0, agentWorkbenchShell_1.scheduleAgentWorkbenchShell)(50), (0, agentWorkbenchShell_1.scheduleAgentWorkbenchShell)(900), (0, agentWorkbenchShell_1.scheduleAgentWorkbenchShell)(2_400));
    statusBar = (0, statusBar_1.activateStatusBar)(context);
    account = (0, account_1.activateAccount)(context, { getSidecar: () => sidecar });
    agents = (0, agents_1.activateAgents)(context, {
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
    preview = (0, preview_1.activatePreview)(context, () => sidecar);
    // Layout manager owns mode + chat position + preview surface choice;
    // the preview surface coordinator routes preview lifecycle between the
    // Swift window (coder mode) and the embedded WebviewPanel (eri mode).
    const layoutManager = new layoutManager_1.LayoutManager();
    context.subscriptions.push({ dispose: () => layoutManager.dispose() });
    const previewCoordinator = (0, surfaceCoordinator_1.createPreviewSurfaceCoordinator)(context, preview, layoutManager);
    const layoutSettingsView = new layoutSettingsView_1.LayoutSettingsViewProvider(layoutManager);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(layoutSettingsView_1.LAYOUT_VIEW_ID, layoutSettingsView), { dispose: () => layoutSettingsView.dispose() });
    (0, themeHub_1.registerThemeHub)(context, () => sidecar);
    (0, phase25_1.activatePhase25Onboarding)(context);
    // When the preview auto-open path (FS watcher / dev-server detect) fires
    // a `shouldOpen` URL, route it through the surface coordinator so
    // eri-mode opens the embedded WebviewPanel rather than the Swift window.
    context.subscriptions.push(preview.onShouldOpen((url) => void previewCoordinator.open(url)));
    // Mode-flip + chat-position side effects (explorer visibility, sidebar
    // location, bottom-panel relocation) are best-effort.
    let lastChatPosition = layoutManager.current().chatPosition;
    context.subscriptions.push(layoutManager.onChange((state) => {
        void (0, layoutManager_1.applyModeSideEffects)(state);
        if (state.chatPosition !== lastChatPosition) {
            lastChatPosition = state.chatPosition;
            void (0, layoutManager_1.applyChatPosition)(state.chatPosition);
        }
    }));
    // Activate tier client right after sidecar starts so the very first
    // setContext + sidecar handshake reflects the user's real tier.
    tierClient = (0, tierClient_1.activateTierClient)(context, () => sidecar);
    (0, tab_1.activateTab)(context, () => sidecar);
    atMentions = (0, at_mentions_1.activateAtMentions)(context, () => sidecar);
    (0, mentions_1.activateMentionCompletions)(context, atMentions.registry);
    mcpRegistry = (0, mcpRegistry_1.activateMcp)(context, () => sidecar);
    gaze = (0, gaze_1.activateGaze)(context, () => sidecar);
    // Gaze-lost talk-back: speak the last reply when the user looks away. Voice
    // is eri_prod_voice (the TTS sidecar default). No-op if the sidecar is down.
    gazeNarration = new gazeNarration_1.GazeNarration(gaze.service());
    context.subscriptions.push(gazeNarration);
    composer = (0, composer_1.activateComposer)(context, () => sidecar, atMentions);
    checkpoints = (0, checkpoints_1.activateCheckpoints)(context, () => sidecar);
    apply = (0, apply_1.activateApply)(context, () => sidecar);
    // Phase 17a — opt-in event-triggered Janitor rules. The watcher
    // consults `.eri/janitor.json` and fires the configured slash
    // commands on matching save events. Disabled unless the user flips
    // `eri.background.rulesEnabled`.
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
        context.subscriptions.push((0, janitorRulesWatcher_1.activateJanitorRulesWatcher)(context, {
            workspaceRoot,
            getSidecar: () => sidecar,
        }));
    }
    // Phase 23 — onboarding modal. Fires on first sign-in via the
    // session listener below; can also be run manually via the command
    // palette ("eri: Run onboarding").
    context.subscriptions.push(vscode.commands.registerCommand("eri.onboarding.run", async () => {
        const { runOnboarding } = await Promise.resolve().then(() => require("./onboarding/buildStyleQuestions"));
        const result = await runOnboarding();
        if (!result)
            return;
        vscode.window.showInformationMessage(`eri — preferences written to ${result.preferencesPath}.`);
        if (result.themeSuggestion) {
            await vscode.commands.executeCommand("eri.themes.setActive", { slug: result.themeSuggestion });
        }
    }));
    // First-time fire — flips a globalState flag so we never prompt twice.
    context.subscriptions.push(account.store.onChange((session) => {
        if (!session)
            return;
        const flag = "eri.onboarding.completedV1";
        if (context.globalState.get(flag))
            return;
        void context.globalState.update(flag, true);
        void vscode.commands.executeCommand("eri.onboarding.run");
    }));
    // Phase 21b — `/document <path-or-url>` command. Reads a local file
    // or downloads an HTTP target, extracts text (PDFs get heuristic
    // parsing; everything else is read as UTF-8), opens a paginated
    // markdown summary the user can chat against.
    context.subscriptions.push(vscode.commands.registerCommand("eri.document.run", async (args) => {
        const target = args?.target ??
            (await vscode.window.showInputBox({
                prompt: "/document — paste a file path or URL",
                placeHolder: "./paper.pdf or https://arxiv.org/abs/...",
                ignoreFocusOut: true,
            }));
        if (!target)
            return;
        try {
            const { runDocument, showDocumentResult } = await Promise.resolve().then(() => require("./document"));
            const result = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `eri /document — extracting ${target}…`,
                cancellable: false,
            }, () => runDocument({ target }));
            await showDocumentResult(result);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`eri /document failed: ${msg}`);
        }
    }));
    // Phase 21a — `/tracer <github-url> <query>` command. Clones a
    // remote repo into ~/.eri/sandboxes/<sha>/, indexes it, runs a
    // search, opens the markdown report. Tear-down happens when the
    // user dismisses the result document.
    context.subscriptions.push(vscode.commands.registerCommand("eri.tracer.run", async (args) => {
        const sc = sidecar;
        if (!sc) {
            vscode.window.showWarningMessage("eri /tracer — sidecar not running.");
            return;
        }
        const { runTracer, showTracerResultDocument, parseTracerArgs } = await Promise.resolve().then(() => require("./tracer"));
        let url = args?.url;
        let query = args?.query;
        if (!url || !query) {
            const free = await vscode.window.showInputBox({
                prompt: "/tracer — paste `<github-url> <query>`",
                placeHolder: "https://github.com/anthropics/anthropic-sdk-python how does streaming work?",
                ignoreFocusOut: true,
            });
            if (!free)
                return;
            const parsed = parseTracerArgs(free);
            if (!parsed) {
                vscode.window.showWarningMessage("Provide both a URL and a query.");
                return;
            }
            url = parsed.url;
            query = parsed.query;
        }
        try {
            const result = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `eri /tracer — cloning + indexing ${url}…`,
                cancellable: false,
            }, () => runTracer({ url: url, query: query, sidecar: sc }));
            await showTracerResultDocument(result);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`eri /tracer failed: ${msg}`);
        }
    }));
    // Auto-open the Swift preview window whenever an iteration applies an
    // `index.html` build. Gated by `eri.preview.autoOpenOnBuild`. The hook
    // looks at the apply orchestrator's `committed` event, which is the only
    // signal we have post-disk-write that doesn't require a sidecar push.
    context.subscriptions.push(apply.onDidChange((event) => {
        if (event.kind !== "committed") {
            return;
        }
        const autoOpen = vscode.workspace
            .getConfiguration("eri.preview")
            .get("autoOpenOnBuild", true);
        if (!autoOpen) {
            return;
        }
        const built = (event.result?.applied ?? []).find((a) => a.path.toLowerCase().endsWith("index.html"));
        if (!built) {
            return;
        }
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            return;
        }
        const url = vscode.Uri.joinPath(folder.uri, built.path).toString();
        preview?.fireShouldOpen(url);
    }));
    skills = (0, skills_1.activateSkills)(context, () => sidecar);
    // Ship activates after `apply` so the orchestrator is available, and after
    // `account` so the tier gate is wired. Progress goes straight to the panel
    // webview as `eri/ship/progress` messages.
    slashRegistry = (0, registry_1.activateSlashRegistry)(context, () => sidecar);
    void slashRegistry;
    snippets = (0, snippets_1.activateSnippets)(context);
    void snippets;
    ship = (0, ship_1.activateShip)(context, {
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
    onboarding = (0, onboarding_1.activateOnboarding)(context, () => sidecar);
    settingsHub = (0, settingsHub_1.activateSettingsHub)(context);
    codemaps = (0, codemaps_1.activateCodemaps)(context, () => sidecar);
    graph = (0, graph_1.activateGraph)(context, () => sidecar);
    terminalVoiceGaze = (0, terminals_1.activateTerminalVoiceGaze)(context, () => sidecar, async (transcript) => (0, intentDispatcher_1.tryDispatchViewIntent)(transcript, {
        previewCoordinator,
        getSidecar: () => sidecar,
        layout: layoutManager,
    }), async (transcript) => (0, voiceRouter_1.tryRouteVoiceTranscript)(transcript, {
        getSidecar: () => sidecar,
        snapshot: () => {
            const layoutState = layoutManager.current();
            return {
                mode: layoutState.mode,
                chatPosition: layoutState.chatPosition,
                previewSurface: previewCoordinator.active(),
                activeEditor: vscode.window.activeTextEditor?.document.uri.fsPath ?? null,
                terminals: vscode.window.terminals.map((t) => ({ name: t.name })),
            };
        },
        onChatReply: (reply) => {
            panelProvider?.postToWebview({
                method: "eri/voice/reply",
                params: { text: reply },
            });
            // Arm gaze-lost talk-back with this reply.
            gazeNarration?.setReply(reply);
        },
    }));
    review = (0, review_1.activateReview)(context, () => sidecar);
    mcpPresets = (0, mcpPresets_1.activateMcpPresets)(context);
    hooks = (0, hooks_1.activateHooks)(context, () => sidecar);
    audit = (0, audit_1.activateAudit)(context, () => sidecar);
    crash = (0, crash_1.activateCrash)(context, () => sidecar);
    visualEditor = (0, visualEditor_1.activateVisualEditor)(context, () => sidecar);
    // Surface an "you're signed in to eri" banner in the BYOK view so users
    // understand the precedence (BYOK key overrides eri's tier).
    const bannerEmitter = new vscode.EventEmitter();
    const accountCapture = account;
    if (accountCapture) {
        context.subscriptions.push(accountCapture.store.onChange(() => bannerEmitter.fire()), accountCapture.usage.onUsage(() => bannerEmitter.fire()), bannerEmitter);
    }
    const accountBanner = {
        getBanner: () => {
            const session = accountCapture?.store.current() ?? null;
            if (!session)
                return null;
            // Pull labels from the canonical TIER_LABELS map so the BYOK banner
            // stays in sync with the rest of the IDE (status bar, status webview).
            // No local fallback table — drift between this file and types.ts is
            // exactly the bug we fixed when we moved to backend slugs.
            const label = require("./account/types").TIER_LABELS[session.tier] ?? "Free";
            return { email: session.email, tierLabel: label };
        },
        onChange: bannerEmitter.event,
    };
    byokView = new settingsView_1.ByokSettingsView(context, secretsStore, accountBanner);
    const localView = byokView;
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(settingsView_1.BYOK_VIEW_ID, byokView), vscode.commands.registerCommand("eri.byok.setKey", async () => {
        await localView.pickAndSet();
    }), vscode.commands.registerCommand("eri.byok.clearAll", async () => {
        await localView.clearAll();
    }), vscode.commands.registerCommand("eri.settings.open", async () => {
        await vscode.commands.executeCommand("workbench.view.extension.eri-activitybar");
        await vscode.commands.executeCommand(`${settingsView_1.BYOK_VIEW_ID}.focus`);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("eri.openPreview", () => {
        vscode.commands.executeCommand("eri.preview.open");
    }), vscode.commands.registerCommand("eri.toggleMic", () => {
        sidecar?.notify("eri/voice/toggle", {});
    }), vscode.commands.registerCommand("eri.inlineEdit", () => {
        vscode.commands.executeCommand("editor.action.eriInlineEdit").then(undefined, () => {
            vscode.window.showInformationMessage("eri inline edit — widget contribution missing");
        });
    }), vscode.commands.registerCommand("eri.openChat", () => {
        // Reveal the eri activity-bar container and focus the chat view inside it.
        vscode.commands.executeCommand("workbench.view.extension.eri-activitybar").then(() => vscode.commands.executeCommand("eri.panel.focus"), () => undefined);
    }), vscode.commands.registerCommand("eri.openComposer", () => {
        composer?.open();
    }), vscode.commands.registerCommand("eri.openAgentLayout", async () => {
        // Cmd+E entrypoint — historically a stub. Now flips between coder
        // and eri mode via LayoutManager; the panel keeps its previous
        // notification for the inline UI affordance.
        panelProvider?.postToWebview({ method: "eri/ui/agentLayout", params: {} });
        const next = layoutManager.current().mode === "coder" ? "eri" : "coder";
        await layoutManager.setMode(next);
    }), vscode.commands.registerCommand("eri.modeMenu", async () => {
        panelProvider?.postToWebview({ method: "eri/ui/modeMenu", params: {} });
        const pick = await vscode.window.showQuickPick([
            { label: "$(layout) Coder mode", value: "coder" },
            { label: "$(sparkle) eri mode", value: "eri" },
        ], { placeHolder: "Switch layout mode" });
        if (pick)
            await layoutManager.setMode(pick.value);
    }), vscode.commands.registerCommand("eri.layout.toggleMode", async () => {
        const next = layoutManager.current().mode === "coder" ? "eri" : "coder";
        await layoutManager.setMode(next);
    }), vscode.commands.registerCommand("eri.layout.setChatPosition", async (pos) => {
        const value = pos
            ?? (await vscode.window.showQuickPick([
                { label: "Left", value: "left" },
                { label: "Right", value: "right" },
                { label: "Bottom", value: "bottom" },
            ], { placeHolder: "Where should the eri chat panel dock?" }))?.value;
        if (value === "left" || value === "right" || value === "bottom") {
            await layoutManager.setChatPosition(value);
        }
    }), vscode.commands.registerCommand("eri.layout.openSettings", async () => {
        await vscode.commands.executeCommand("workbench.view.extension.eri-activitybar");
        await vscode.commands.executeCommand("eri.layoutSettings.focus");
    }), vscode.commands.registerCommand("eri.cycleModel", () => {
        sidecar?.notify("eri/model/cycle", {});
    }), vscode.commands.registerCommand("eri.acceptIteration", () => {
        sidecar?.notify("eri/iteration/accept", {});
    }), vscode.commands.registerCommand("eri.rejectIteration", () => {
        sidecar?.notify("eri/iteration/reject", {});
    }), vscode.commands.registerCommand("eri.stopGeneration", () => {
        sidecar?.notify("eri/inference/cancel", {});
    }), vscode.commands.registerCommand("eri.setDiffusionFire", (active) => {
        vscode.commands.executeCommand("setContext", "eri.diffusionFire", !!active);
    }));
}
function deactivate() {
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
    gazeNarration?.dispose();
    gazeNarration = null;
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
function handleNotification(notification) {
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
            const params = notification.params;
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
                        statusBar.setState(typeof params.line === "number"
                            ? { kind: "gazing", line: params.line }
                            : { kind: "gazing" });
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
            const params = typeof notification.params === "object" && notification.params
                ? notification.params
                : {};
            const url = params.url ?? deriveUrlFromSessionPath(params.sessionPath);
            if (url) {
                preview?.fireShouldOpen(url);
            }
            break;
        }
        case "eri/mcp/serverStatus": {
            const params = notification.params;
            if (params && typeof params.name === "string" && mcpRegistry) {
                const allowed = ["online", "offline", "error"];
                const state = typeof params.state === "string" && allowed.includes(params.state)
                    ? params.state
                    : undefined;
                (0, mcpRegistry_1.applyServerStatus)(mcpRegistry.view, {
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
function maybeRelayGazeToPreview(notification) {
    if (notification.method !== "eri/gaze/target") {
        return;
    }
    const relayEnabled = vscode.workspace
        .getConfiguration("eri.preview")
        .get("gazeRelay", true);
    if (!relayEnabled) {
        return;
    }
    if (!notification.params || typeof notification.params !== "object") {
        return;
    }
    const params = notification.params;
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
function deriveUrlFromSessionPath(sessionPath) {
    if (!sessionPath || sessionPath === "") {
        return null;
    }
    return vscode.Uri.file(sessionPath + "/index.html").toString();
}
//# sourceMappingURL=extension.js.map