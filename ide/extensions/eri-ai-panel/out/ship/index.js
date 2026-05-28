"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateShip = activateShip;
const vscode = require("vscode");
const overQuotaModal_1 = require("../account/overQuotaModal");
const branchAutomation_1 = require("./branchAutomation");
const shipClient_1 = require("./shipClient");
const tandemProgress_1 = require("./tandemProgress");
const ECONOMIC_EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".rs",
    ".go",
    ".py",
    ".java",
    ".kt",
    ".swift",
    ".html",
    ".css",
    ".json",
    ".md",
    ".toml",
    ".yaml",
    ".yml",
]);
const SHIP_FILE_LIMIT = 25; // hard cap; ship payload over this is wasteful
const SHIP_BYTES_LIMIT = 64 * 1024; // skip files larger than 64KB
/**
 * Wire the `eri/ship/run` JSON-RPC flow into the extension:
 *
 * 1. Gather the open workspace files into a bounded payload.
 * 2. Render two-builder + one-checker progress as events arrive.
 * 3. On `ship_done`, hand the merged search/replace patchset to the
 *    existing `ApplyOrchestrator` so the Pending Edits view + auto-checkpoint
 *    flow Just Works.
 *
 * Free tier: the panel's Ship button text is "Upgrade to ship" and clicking
 * never reaches this module — extension routes it to `openExternal` instead.
 */
function activateShip(context, options) {
    const client = new shipClient_1.ShipClient(options.getSidecar);
    const reducer = new tandemProgress_1.TandemProgressReducer();
    // Forward streaming events into the reducer + caller's progress sink.
    context.subscriptions.push(client.onEvent((event) => {
        const state = reducer.apply(event);
        options.onProgress(state);
    }));
    const runImpl = async (instructions) => {
        if (instructions.trim().length === 0) {
            vscode.window.showWarningMessage("Ship needs an instruction. Type what to ship.");
            return;
        }
        const session = options.account?.store.current() ?? null;
        if (session && session.tier === "free") {
            const action = await vscode.window.showInformationMessage("Ship runs Sonnet + GPT + Gemini in tandem. Upgrade to Pro for 750k frontier tokens (~25 ships).", "Upgrade", "Use my own keys");
            if (action === "Upgrade") {
                await vscode.env.openExternal(vscode.Uri.parse("https://eri.dev/dashboard/billing?plan=pro&billing=monthly"));
            }
            else if (action === "Use my own keys") {
                await vscode.commands.executeCommand("eri.byok.setKey");
            }
            return;
        }
        const workspaceFiles = await collectWorkspaceFiles();
        if (workspaceFiles.length === 0) {
            vscode.window.showWarningMessage("No workspace files in scope for ship.");
            return;
        }
        // Reset + seed the reducer so the UI shows the planned slots before the
        // first server-side event lands.
        const initial = reducer.begin(["claude-sonnet-4-5-20251015", "gpt-4o"], "gemini-2.0-flash-thinking-exp");
        options.onProgress(initial);
        try {
            const result = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "eri · shipping with Sonnet + GPT-4o + Gemini",
                cancellable: false,
            }, () => client.run({ instructions, workspaceFiles }));
            if (!result.ok) {
                vscode.window.showErrorMessage(`Ship failed${result.survivors.length === 0 ? " (no survivors)" : ""}.`);
                return;
            }
            if (result.mergedPatchset.trim().length === 0) {
                vscode.window.showWarningMessage("Ship completed with no edits.");
                return;
            }
            // Phase 16c — opt-in branch automation. When enabled, swap onto a
            // fresh `eri/ship-<slug>-<stamp>` branch BEFORE the apply commit
            // lands so the ship doesn't pollute the user's current branch.
            const autoBranch = vscode.workspace
                .getConfiguration("eri.ship")
                .get("autoBranch", false);
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            let createdBranch = null;
            if (autoBranch && workspaceRoot) {
                createdBranch = await (0, branchAutomation_1.switchToShipBranch)({ workspaceRoot }, instructions);
                if (!createdBranch) {
                    // Tell the user the automation didn't fire (no git, etc.) but
                    // don't abort the ship — the commit will just land on the
                    // current branch as before.
                    vscode.window.showWarningMessage(`Couldn't create branch ${(0, branchAutomation_1.branchName)(instructions)}; shipping on current branch.`);
                }
            }
            // Hand off to the existing apply pipeline → diff viewer + checkpoint.
            const edits = await options.applyOrchestrator.stage(result.mergedPatchset);
            const applyResult = await options.applyOrchestrator.commit(edits.map((e) => ({ ...e, accepted: true })));
            options.onComplete?.({
                applied: applyResult.applied.length,
                failed: applyResult.failed.length,
            });
            const survivorLabel = result.survivors.join(" + ");
            if (createdBranch) {
                const autoOpenPr = vscode.workspace
                    .getConfiguration("eri.ship")
                    .get("autoOpenPr", false);
                const action = await vscode.window.showInformationMessage(`Shipped ${applyResult.applied.length} edits via ${survivorLabel} on branch ${createdBranch}.`, "Open PR", "OK");
                if (action === "Open PR" ||
                    (autoOpenPr && workspaceRoot)) {
                    const opened = workspaceRoot
                        ? await (0, branchAutomation_1.openPullRequest)({ workspaceRoot })
                        : false;
                    if (!opened) {
                        vscode.window.showWarningMessage("Couldn't open a PR — install GitHub CLI (`gh`) and run `gh auth login`.");
                    }
                }
            }
            else {
                vscode.window.showInformationMessage(`Shipped ${applyResult.applied.length} edits via ${survivorLabel}.`);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if ((0, overQuotaModal_1.isOverQuotaError)(error)) {
                await (0, overQuotaModal_1.showOverQuotaModal)({ tier: session?.tier });
                return;
            }
            if ((0, overQuotaModal_1.isRateLimitedError)(error)) {
                await (0, overQuotaModal_1.showRateLimitToast)({
                    ...(0, overQuotaModal_1.parseRateLimitedPayload)(error),
                    statusBar: options.account?.statusBar,
                });
                return;
            }
            vscode.window.showErrorMessage(`Ship failed: ${message}`);
        }
    };
    context.subscriptions.push(vscode.commands.registerCommand("eri.ship.run", async (instructions) => {
        const input = typeof instructions === "string"
            ? instructions
            : await vscode.window.showInputBox({
                prompt: "What should eri ship?",
                placeHolder: "e.g. refactor src/auth into stateless functions, add tests",
                ignoreFocusOut: true,
            });
        if (typeof input !== "string") {
            return;
        }
        await runImpl(input);
    }), vscode.commands.registerCommand("eri.ship.cancel", () => {
        // Streaming RPC has no cancellation hook yet — surface a TODO toast
        // so the UI is honest about the limitation. Phase 3.4 adds an abort
        // channel via the sidecar.
        vscode.window.showInformationMessage("Cancel mid-ship isn't supported yet. Wait for the current ship to finish or close the panel.");
    }), client);
    return {
        client,
        forward: (notification) => client.forward(notification),
        run: runImpl,
        dispose: () => client.dispose(),
    };
}
/**
 * Collect the current workspace's source files for the ship payload.
 * Bounded by file count + per-file size. We deliberately err on the side
 * of "small payload, fewer files" because the builders + checker pay
 * tokens proportional to total bytes; ship is the most expensive turn.
 */
async function collectWorkspaceFiles() {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
        return [];
    }
    const folder = folders[0];
    const pattern = new vscode.RelativePattern(folder, "**/*");
    const excludePattern = "**/{node_modules,target,dist,build,.next,.cache,.git,.eri,.vscode}/**";
    const uris = await vscode.workspace.findFiles(pattern, excludePattern, 200);
    const out = [];
    for (const uri of uris) {
        const ext = uri.path.slice(uri.path.lastIndexOf("."));
        if (!ECONOMIC_EXTENSIONS.has(ext)) {
            continue;
        }
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.size > SHIP_BYTES_LIMIT) {
                continue;
            }
            const bytes = await vscode.workspace.fs.readFile(uri);
            out.push({
                path: vscode.workspace.asRelativePath(uri, false),
                content: Buffer.from(bytes).toString("utf8"),
            });
            if (out.length >= SHIP_FILE_LIMIT) {
                break;
            }
        }
        catch {
            // Best-effort: skip unreadable files.
        }
    }
    return out;
}
//# sourceMappingURL=index.js.map