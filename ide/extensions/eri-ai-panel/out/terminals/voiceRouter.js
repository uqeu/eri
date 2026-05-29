"use strict";
// Natural-language voice intent router (LLM-backed).
//
// Sits BEHIND the regex/Jaccard fast-path. When the local classifier
// can't claim a transcript, we ask the sidecar's `eri/voice/route`
// to map the utterance to an allowlisted IDE command or to a chat
// reply. The LLM runs through the eri agent layer so whatever
// model the user has active handles classification — including
// Mercury via its streaming backend.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOWED_VOICE_COMMANDS = void 0;
exports.tryRouteVoiceTranscript = tryRouteVoiceTranscript;
const vscode = require("vscode");
/**
 * Allowed commands the LLM router may emit. Same list as the sidecar's
 * allowlist but enforced again here as defence in depth — a malicious
 * (or hallucinating) model that bypasses the sidecar check still can't
 * invoke arbitrary VS Code commands.
 */
exports.ALLOWED_VOICE_COMMANDS = new Set([
    "eri.layout.toggleMode",
    "eri.layout.setChatPosition",
    "eri.layout.openSettings",
    "eri.themes.openHub",
    "eri.preview.zoom",
    "eri.preview.scroll",
    "eri.preview.reload",
    "eri.openChat",
    "eri.openComposer",
    "eri.openPreview",
    "eri.agents.switch",
    "eri.ship.run",
    "eri.acceptIteration",
    "eri.rejectIteration",
    "eri.stopGeneration",
    "eri.mentions.openPicker",
    "eri.checkpoints.create",
    "eri.checkpoints.restore",
    "eri.review.run",
    "workbench.action.quickOpen",
    "workbench.action.findInFiles",
    "workbench.action.terminal.focus",
    "workbench.action.toggleSidebarVisibility",
    "editor.action.fontZoomIn",
    "editor.action.fontZoomOut",
    "editor.action.scrollPageDown",
    "editor.action.scrollPageUp",
    "editor.action.scrollLineDown",
    "editor.action.scrollLineUp",
]);
/**
 * Try to handle a transcript via the LLM router. Returns `true` when
 * the router claimed it (executed a command OR surfaced a chat reply);
 * `false` when the caller should fall back to its own handling.
 */
async function tryRouteVoiceTranscript(transcript, deps) {
    const text = transcript.trim();
    if (text.length === 0)
        return false;
    const sidecar = deps.getSidecar();
    if (!sidecar)
        return false;
    try {
        const report = await sidecar.request("eri/voice/route", {
            transcript: text,
            context: deps.snapshot ? deps.snapshot() : {},
        });
        return await dispatch(report, deps);
    }
    catch (err) {
        console.warn("[eri voice router] sidecar request failed:", err);
        return false;
    }
}
async function dispatch(report, deps) {
    switch (report.kind) {
        case "command": {
            if (!exports.ALLOWED_VOICE_COMMANDS.has(report.command)) {
                console.warn(`[eri voice router] sidecar emitted non-allowlisted command: ${report.command}`);
                return false;
            }
            try {
                await invokeCommand(report.command, report.args ?? {});
                // Surface a quick status so hands-free users know it worked.
                vscode.window.setStatusBarMessage(`eri: ${humanLabel(report.command)}`, 2000);
                return true;
            }
            catch (err) {
                console.error(`[eri voice router] command ${report.command} failed:`, err);
                return false;
            }
        }
        case "chat": {
            const reply = (report.reply ?? "").trim();
            if (reply.length === 0)
                return false;
            if (deps.onChatReply) {
                deps.onChatReply(reply);
            }
            else {
                vscode.window.showInformationMessage(`eri: ${reply}`);
            }
            return true;
        }
        case "none":
        default:
            return false;
    }
}
/**
 * Map a small set of commands to a positional/parameter call shape so
 * the LLM's `{ args: { ... } }` translates cleanly. Anything not listed
 * here is called with no arguments — that's intentional, since most
 * eri.* commands are nullary.
 */
async function invokeCommand(command, args) {
    switch (command) {
        case "eri.layout.setChatPosition":
            await vscode.commands.executeCommand(command, args.chatPosition);
            return;
        case "workbench.action.quickOpen":
            await vscode.commands.executeCommand(command, args.query);
            return;
        case "workbench.action.findInFiles":
            await vscode.commands.executeCommand(command, { query: args.query ?? "" });
            return;
        case "eri.preview.zoom":
        case "eri.preview.scroll":
            // These notify the sidecar directly; no executeCommand wiring needed
            // unless the extension registers wrappers (which today it doesn't).
            // Fall through to the generic executeCommand path so users can
            // re-bind via package.json should they wish — best-effort.
            await vscode.commands.executeCommand(command, args).then(undefined, () => undefined);
            return;
        default:
            await vscode.commands.executeCommand(command);
            return;
    }
}
function humanLabel(command) {
    // Strip the "eri." / "workbench.action." prefixes for the status bar.
    return command
        .replace(/^eri\./, "")
        .replace(/^workbench\.action\./, "")
        .replace(/^editor\.action\./, "");
}
//# sourceMappingURL=voiceRouter.js.map