"use strict";
// Wires voice transcripts from the sidecar into terminal actions:
// focus, send (type), kill, and layout spawn. Pronoun resolution falls
// through to whichever terminal the user is currently gazing at.
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateTerminalVoice = activateTerminalVoice;
const vscode = require("vscode");
const intentMatcher_1 = require("./intentMatcher");
const VOICE_FINAL_METHOD = "eri/voice/final";
const VOICE_TRANSCRIPT_METHODS = new Set([
    VOICE_FINAL_METHOD,
    // Some sidecar versions emit transcripts under this name; tolerate both.
    "voice/transcript",
]);
const STATUS_MESSAGE_TIMEOUT_MS = 2000;
function activateTerminalVoice(context, options) {
    const disposables = [];
    const handle = {
        forward(notification) {
            if (!VOICE_TRANSCRIPT_METHODS.has(notification.method)) {
                return;
            }
            if (!isVoiceTargetingEnabled()) {
                return;
            }
            const transcript = parseTranscript(notification.params);
            if (!transcript) {
                return;
            }
            void handleTranscript(transcript, options);
        },
        dispose() {
            for (const sub of disposables) {
                sub.dispose();
            }
        },
    };
    context.subscriptions.push({ dispose: () => handle.dispose() });
    return handle;
}
async function handleTranscript(transcript, options) {
    // View intents (zoom / scroll / navigate) take precedence so
    // "show me the hero headline" doesn't get treated as terminal focus.
    if (options.tryDispatchView) {
        try {
            const handled = await options.tryDispatchView(transcript);
            if (handled)
                return;
        }
        catch (err) {
            console.error("voice view-intent dispatch threw:", err);
        }
    }
    const terminals = snapshotTerminals(options);
    const match = (0, intentMatcher_1.matchTerminalIntent)(transcript, terminals, {
        gazeAttendedTerminalId: options.gaze?.attendedTerminalId(),
    });
    if (!match) {
        return;
    }
    await dispatch(match, terminals, options);
}
function snapshotTerminals(options) {
    const listTerminals = options.testHooks?.listTerminals ?? (() => vscode.window.terminals);
    const terminals = listTerminals();
    const blocks = options.blocks;
    const groups = options.groups;
    return terminals.map((t, index) => {
        const id = terminalId(t);
        const group = groups?.describe(t)?.group ?? "default";
        const cwd = groups?.describe(t)?.cwd ?? "";
        const name = t.name ?? "terminal";
        const recent = blocks?.blocksForTerminal(id) ?? [];
        const last = blocks?.lastCommand(id);
        const snapshot = {
            id,
            name,
            group,
            cwd,
            blocks: recent,
            lastActiveAt: index, // higher index → more recent in vscode's tab order
            ...(last ? { lastCommand: last } : {}),
        };
        return snapshot;
    });
}
async function dispatch(match, snapshots, options) {
    const setStatus = options.testHooks?.setStatusMessage ??
        ((text, timeoutMs) => {
            vscode.window.setStatusBarMessage(text, timeoutMs);
        });
    const executeCommand = options.testHooks?.executeCommand ?? vscode.commands.executeCommand;
    if (match.kind === "spawn-layout") {
        if (!match.payload) {
            return;
        }
        setStatus(`eri spawned layout: ${match.payload}`, STATUS_MESSAGE_TIMEOUT_MS);
        try {
            await executeCommand("eri.terminals.restoreLayout", match.payload);
        }
        catch {
            // sibling command may not be registered yet — surface only via status.
        }
        return;
    }
    if (!match.terminalId) {
        return;
    }
    const terminal = lookupTerminal(match.terminalId, options);
    if (!terminal) {
        return;
    }
    const snapshot = snapshots.find((s) => s.id === match.terminalId);
    const displayName = snapshot?.name ?? terminal.name ?? "terminal";
    switch (match.kind) {
        case "focus":
            terminal.show(false);
            setStatus(`eri opened: ${displayName}`, STATUS_MESSAGE_TIMEOUT_MS);
            break;
        case "kill": {
            const soft = vscode.workspace
                .getConfiguration("eri.terminals")
                .get("killSoftCtrlC", true);
            if (soft) {
                // SIGINT-equivalent into the pty.
                terminal.sendText("", false);
                setStatus(`eri sent Ctrl+C to: ${displayName}`, STATUS_MESSAGE_TIMEOUT_MS);
            }
            else {
                terminal.dispose();
                setStatus(`eri killed: ${displayName}`, STATUS_MESSAGE_TIMEOUT_MS);
            }
            break;
        }
        case "send": {
            if (!match.payload) {
                return;
            }
            terminal.sendText(match.payload, true);
            setStatus(`eri ran "${match.payload}" in ${displayName}`, STATUS_MESSAGE_TIMEOUT_MS);
            break;
        }
        default:
            break;
    }
}
function lookupTerminal(id, options) {
    const listTerminals = options.testHooks?.listTerminals ?? (() => vscode.window.terminals);
    return listTerminals().find((t) => terminalId(t) === id);
}
function terminalId(t) {
    // VS Code's Terminal API doesn't expose a stable id; use processId promise's
    // string form when available, or fall back to name + index identity. Since
    // ids must be synchronously available we hash name + creationOptions.
    const opts = t._id;
    if (typeof opts === "string") {
        return opts;
    }
    return `terminal::${t.name ?? "anon"}`;
}
function isVoiceTargetingEnabled() {
    return vscode.workspace
        .getConfiguration("eri.terminals")
        .get("voiceTargeting", true);
}
function parseTranscript(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const params = raw;
    const candidate = typeof params.text === "string"
        ? params.text
        : typeof params.transcript === "string"
            ? params.transcript
            : null;
    if (!candidate) {
        return null;
    }
    const trimmed = candidate.trim();
    return trimmed.length === 0 ? null : trimmed;
}
//# sourceMappingURL=voice.js.map