// Wires voice transcripts from the sidecar into terminal actions:
// focus, send (type), kill, and layout spawn. Pronoun resolution falls
// through to whichever terminal the user is currently gazing at.

import * as vscode from "vscode";
import { Sidecar, SidecarNotification } from "../sidecar";
import {
  IntentMatch,
  TerminalBlockSnapshot,
  TerminalSnapshot,
  matchTerminalIntent,
} from "./intentMatcher";

const VOICE_FINAL_METHOD = "eri/voice/final";
const VOICE_TRANSCRIPT_METHODS = new Set<string>([
  VOICE_FINAL_METHOD,
  // Some sidecar versions emit transcripts under this name; tolerate both.
  "voice/transcript",
]);

const STATUS_MESSAGE_TIMEOUT_MS = 2000;

export interface TerminalBlocksProvider {
  // Returns recent commands for a given vscode terminal id, oldest first.
  blocksForTerminal(terminalId: string): ReadonlyArray<TerminalBlockSnapshot>;
  lastCommand(terminalId: string): string | undefined;
}

export interface GazeAttention {
  // The terminal id currently being attended to, if any.
  attendedTerminalId(): string | undefined;
}

export interface TerminalGroupResolver {
  // Returns a friendly group name + cwd for a vscode terminal, falling back
  // gracefully when the sibling state store has nothing.
  describe(terminal: vscode.Terminal): { group: string; cwd: string; name: string };
}

export interface VoiceWiringOptions {
  readonly getSidecar: () => Sidecar | null;
  readonly blocks?: TerminalBlocksProvider;
  readonly gaze?: GazeAttention;
  readonly groups?: TerminalGroupResolver;
  /**
   * Optional pre-dispatcher for view-control intents (zoom / scroll /
   * navigate). Runs BEFORE the terminal classifier. When it returns
   * true the transcript is considered handled and no terminal-intent
   * matching happens for that transcript.
   */
  readonly tryDispatchView?: (transcript: string) => Promise<boolean>;
  // Test hook — when set, replaces the real vscode terminal collection
  // and status-bar message side-effects.
  readonly testHooks?: VoiceTestHooks;
}

export interface VoiceTestHooks {
  readonly listTerminals: () => ReadonlyArray<vscode.Terminal>;
  readonly setStatusMessage: (text: string, timeoutMs: number) => void;
  readonly executeCommand: (command: string, ...args: unknown[]) => Thenable<unknown>;
}

export interface VoiceHandle {
  readonly forward: (notification: SidecarNotification) => void;
  readonly dispose: () => void;
}

export function activateTerminalVoice(
  context: vscode.ExtensionContext,
  options: VoiceWiringOptions,
): VoiceHandle {
  const disposables: vscode.Disposable[] = [];

  const handle: VoiceHandle = {
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

async function handleTranscript(
  transcript: string,
  options: VoiceWiringOptions,
): Promise<void> {
  // View intents (zoom / scroll / navigate) take precedence so
  // "show me the hero headline" doesn't get treated as terminal focus.
  if (options.tryDispatchView) {
    try {
      const handled = await options.tryDispatchView(transcript);
      if (handled) return;
    } catch (err) {
      console.error("voice view-intent dispatch threw:", err);
    }
  }
  const terminals = snapshotTerminals(options);
  const match = matchTerminalIntent(transcript, terminals, {
    gazeAttendedTerminalId: options.gaze?.attendedTerminalId(),
  });
  if (!match) {
    return;
  }
  await dispatch(match, terminals, options);
}

function snapshotTerminals(options: VoiceWiringOptions): TerminalSnapshot[] {
  const listTerminals =
    options.testHooks?.listTerminals ?? (() => vscode.window.terminals);
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
    const snapshot: TerminalSnapshot = {
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

async function dispatch(
  match: IntentMatch,
  snapshots: ReadonlyArray<TerminalSnapshot>,
  options: VoiceWiringOptions,
): Promise<void> {
  const setStatus =
    options.testHooks?.setStatusMessage ??
    ((text: string, timeoutMs: number) => {
      vscode.window.setStatusBarMessage(text, timeoutMs);
    });
  const executeCommand =
    options.testHooks?.executeCommand ?? vscode.commands.executeCommand;

  if (match.kind === "spawn-layout") {
    if (!match.payload) {
      return;
    }
    setStatus(`eri spawned layout: ${match.payload}`, STATUS_MESSAGE_TIMEOUT_MS);
    try {
      await executeCommand("eri.terminals.restoreLayout", match.payload);
    } catch {
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
        .get<boolean>("killSoftCtrlC", true);
      if (soft) {
        // SIGINT-equivalent into the pty.
        terminal.sendText("", false);
        setStatus(`eri sent Ctrl+C to: ${displayName}`, STATUS_MESSAGE_TIMEOUT_MS);
      } else {
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
      setStatus(
        `eri ran "${match.payload}" in ${displayName}`,
        STATUS_MESSAGE_TIMEOUT_MS,
      );
      break;
    }
    default:
      break;
  }
}

function lookupTerminal(
  id: string,
  options: VoiceWiringOptions,
): vscode.Terminal | undefined {
  const listTerminals =
    options.testHooks?.listTerminals ?? (() => vscode.window.terminals);
  return listTerminals().find((t) => terminalId(t) === id);
}

function terminalId(t: vscode.Terminal): string {
  // VS Code's Terminal API doesn't expose a stable id; use processId promise's
  // string form when available, or fall back to name + index identity. Since
  // ids must be synchronously available we hash name + creationOptions.
  const opts = (t as unknown as { _id?: string })._id;
  if (typeof opts === "string") {
    return opts;
  }
  return `terminal::${t.name ?? "anon"}`;
}

function isVoiceTargetingEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("eri.terminals")
    .get<boolean>("voiceTargeting", true);
}

function parseTranscript(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const params = raw as Record<string, unknown>;
  const candidate =
    typeof params.text === "string"
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
