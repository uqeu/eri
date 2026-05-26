// Glue between native VS Code terminals and our metadata store. Owns the
// mapping `vscode.Terminal ↔ TerminalRecord.key`, tracks status, applies
// auto-naming, and forwards lifecycle events to the audit log.

import * as vscode from "vscode";
import {
  StateSnapshot,
  TerminalKey,
  TerminalRecord,
  TerminalStateStore,
  generateGroupId,
  removeTerminal,
  terminalKeyFromNative,
  updateGroup,
  upsertTerminal,
} from "./state";
import { autoGroupNameFromCwd, resolveAutoGroup } from "./cwdGrouping";
import { inferTerminalName, stripPromptPrefix } from "./autoName";
import { AuditSink, makeEvent } from "./auditLog";
import { TerminalRuntime, TerminalStatus } from "./treeProvider";
import { BlockStore, TerminalBlock } from "./blocks";
import { CliKind, detectCli } from "./cliDetect";

const IDLE_THRESHOLD_MS = 30_000;

interface Slot {
  readonly terminal: vscode.Terminal;
  key: TerminalKey;
  status: TerminalStatus;
  lastCommand: string | null;
  lastActivityMs: number;
  lastExitCode: number | null;
  /**
   * Command line of the currently-running execution (live only between
   * `onDidStartTerminalShellExecution` and `onDidEndTerminalShellExecution`).
   * `null` when the terminal is idle.
   */
  runningCommand: string | null;
  /**
   * CLI kind currently running in this terminal (`"claude" | "codex" | "aider"`).
   * Used by the chat composer to route prompts into an already-running CLI
   * subprocess instead of forcing the user to pick the terminal.
   */
  cliKind: CliKind | null;
}

export class TerminalsRuntime implements TerminalRuntime {
  private readonly slots = new Map<vscode.Terminal, Slot>();
  private readonly keyToTerminal = new Map<TerminalKey, vscode.Terminal>();
  private readonly disposables: vscode.Disposable[] = [];
  private counter = 0;
  private idleTimer: NodeJS.Timeout | undefined;
  private readonly emitter = new vscode.EventEmitter<TerminalKey>();
  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly store: TerminalStateStore,
    private readonly blocks: BlockStore,
    private readonly audit: AuditSink,
  ) {
    this.disposables.push(
      vscode.window.onDidOpenTerminal((terminal) => this.adopt(terminal)),
      vscode.window.onDidCloseTerminal((terminal) => this.release(terminal)),
      vscode.window.onDidStartTerminalShellExecution((event) =>
        this.handleStart(event),
      ),
      vscode.window.onDidEndTerminalShellExecution((event) =>
        this.handleEnd(event),
      ),
      vscode.window.onDidChangeTerminalShellIntegration((event) =>
        this.handleIntegrationChange(event),
      ),
      this.blocks.subscribe((key, block) => this.onBlock(key, block)),
    );
    // Adopt terminals that already exist (e.g. restored on reload).
    for (const terminal of vscode.window.terminals) {
      this.adopt(terminal);
    }
    this.idleTimer = setInterval(() => this.recomputeIdle(), 5_000);
  }

  resolveKey(terminal: vscode.Terminal): TerminalKey | undefined {
    return this.slots.get(terminal)?.key;
  }

  resolveTerminal(key: TerminalKey): vscode.Terminal | undefined {
    return this.keyToTerminal.get(key);
  }

  status(key: TerminalKey): TerminalStatus {
    const terminal = this.keyToTerminal.get(key);
    if (!terminal) {
      return "exited-fail";
    }
    const slot = this.slots.get(terminal);
    return slot?.status ?? "idle";
  }

  lastCommand(key: TerminalKey): string | null {
    const terminal = this.keyToTerminal.get(key);
    if (!terminal) {
      return null;
    }
    return this.slots.get(terminal)?.lastCommand ?? null;
  }

  /**
   * The CLI kind running in this terminal right now (`"claude" | "codex" | "aider"`),
   * or `null` when the terminal is idle / running something else.
   */
  cliKind(key: TerminalKey): CliKind | null {
    const terminal = this.keyToTerminal.get(key);
    if (!terminal) return null;
    return this.slots.get(terminal)?.cliKind ?? null;
  }

  /**
   * The first live terminal currently running the given CLI, or `undefined`
   * when no terminal is hosting it. Used by `/agent claudeCode` and friends
   * to pipe prompts into an existing subprocess instead of spawning a new
   * one. Iteration order matches insertion order so the oldest matching
   * terminal wins — the user's "primary" claude-code session is usually the
   * first one they spawned.
   */
  findCliTerminal(kind: CliKind): vscode.Terminal | undefined {
    for (const slot of this.slots.values()) {
      if (slot.cliKind === kind) {
        return slot.terminal;
      }
    }
    return undefined;
  }

  liveSlots(): ReadonlyArray<Slot> {
    return [...this.slots.values()];
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = undefined;
    }
    this.slots.clear();
    this.keyToTerminal.clear();
    this.emitter.dispose();
  }

  // Lifecycle ---------------------------------------------------------------

  private adopt(terminal: vscode.Terminal): void {
    if (this.slots.has(terminal)) {
      return;
    }
    this.counter += 1;
    const key = terminalKeyFromNative(terminal, this.counter);
    const cwd = currentCwd(terminal);
    const snapshot = this.store.current();
    const reused = matchExistingRecord(snapshot, terminal, cwd);
    const finalKey = reused?.key ?? key;
    if (reused) {
      // Re-bind: keep the old key so persistence + block store survive.
      this.blocks.reassignTerminalKey(reused.key, finalKey);
    }
    const slot: Slot = {
      terminal,
      key: finalKey,
      status: "idle",
      lastCommand: reused ? null : null,
      lastActivityMs: Date.now(),
      lastExitCode: null,
      runningCommand: null,
      cliKind: null,
    };
    this.slots.set(terminal, slot);
    this.keyToTerminal.set(finalKey, terminal);

    const outcome = reused
      ? { snapshot, groupId: reused.groupId, created: false }
      : resolveAutoGroup(snapshot, cwd ?? "");
    const record: TerminalRecord = {
      key: finalKey,
      groupId: outcome.groupId,
      name: reused?.name ?? terminal.name,
      nameLocked: reused?.nameLocked ?? false,
      cwd: cwd ?? reused?.cwd,
      icon: reused?.icon,
      createdAtMs: reused?.createdAtMs ?? Date.now(),
    };
    void this.store.apply(upsertTerminal(outcome.snapshot, record));
    void this.audit.append(
      makeEvent("terminal.spawn", {
        key: finalKey,
        name: terminal.name,
        cwd: cwd ?? null,
        autoGroup: outcome.created,
        groupId: outcome.groupId,
      }),
    );
    this.emitter.fire(finalKey);
  }

  private release(terminal: vscode.Terminal): void {
    const slot = this.slots.get(terminal);
    if (!slot) {
      return;
    }
    this.slots.delete(terminal);
    this.keyToTerminal.delete(slot.key);
    const snapshot = this.store.current();
    void this.store.apply(removeTerminal(snapshot, slot.key));
    void this.audit.append(
      makeEvent("terminal.kill", {
        key: slot.key,
        lastExitCode: slot.lastExitCode,
      }),
    );
    this.blocks.clearTerminal(slot.key);
    this.emitter.fire(slot.key);
  }

  private handleStart(event: vscode.TerminalShellExecutionStartEvent): void {
    const slot = this.slots.get(event.terminal);
    if (!slot) {
      return;
    }
    slot.status = "running";
    slot.lastActivityMs = Date.now();
    const command = event.execution.commandLine?.value ?? slot.lastCommand;
    slot.lastCommand = command;
    slot.runningCommand = command ?? null;
    slot.cliKind = detectCli(command);
    this.emitter.fire(slot.key);
  }

  private handleEnd(event: vscode.TerminalShellExecutionEndEvent): void {
    const slot = this.slots.get(event.terminal);
    if (!slot) {
      return;
    }
    const exit = typeof event.exitCode === "number" ? event.exitCode : null;
    slot.lastExitCode = exit;
    slot.status = exit === 0 ? "exited-ok" : exit === null ? "idle" : "exited-fail";
    slot.lastActivityMs = Date.now();
    slot.runningCommand = null;
    slot.cliKind = null;
    const command = event.execution.commandLine?.value;
    if (command) {
      slot.lastCommand = command;
      void this.maybeAutoRename(slot, command);
    }
    this.emitter.fire(slot.key);
  }

  private handleIntegrationChange(
    event: vscode.TerminalShellIntegrationChangeEvent,
  ): void {
    const slot = this.slots.get(event.terminal);
    if (!slot) {
      return;
    }
    const cwd = event.shellIntegration.cwd?.fsPath;
    if (cwd && cwd.length > 0) {
      const snapshot = this.store.current();
      const record = snapshot.terminals.find((t) => t.key === slot.key);
      if (record && record.cwd !== cwd) {
        void this.store.apply(
          upsertTerminal(snapshot, { ...record, cwd }),
        );
      }
    }
  }

  private onBlock(_key: TerminalKey, _block: TerminalBlock): void {
    // The block capture itself already updates state; here we just nudge UI.
    this.emitter.fire(_key);
  }

  // Auto-rename ----------------------------------------------------------

  private async maybeAutoRename(slot: Slot, command: string): Promise<void> {
    const snapshot = this.store.current();
    const record = snapshot.terminals.find((t) => t.key === slot.key);
    if (!record || record.nameLocked) {
      return;
    }
    const inferred = inferTerminalName(stripPromptPrefix(command));
    if (!inferred || inferred === record.name) {
      return;
    }
    await this.store.apply(
      upsertTerminal(snapshot, { ...record, name: inferred }),
    );
    void this.audit.append(
      makeEvent("terminal.rename", {
        key: slot.key,
        from: record.name,
        to: inferred,
        auto: true,
      }),
    );
  }

  // Idle scanner ---------------------------------------------------------

  private recomputeIdle(): void {
    const now = Date.now();
    for (const slot of this.slots.values()) {
      if (slot.status !== "running") {
        continue;
      }
      if (now - slot.lastActivityMs > IDLE_THRESHOLD_MS) {
        slot.status = "idle";
        this.emitter.fire(slot.key);
      }
    }
  }

  // Group helpers consumed by command handlers --------------------------

  async createGroup(name: string, icon?: string): Promise<string> {
    const snapshot = this.store.current();
    const id = generateGroupId();
    await this.store.apply({
      ...snapshot,
      groups: [
        ...snapshot.groups,
        {
          id,
          name,
          icon,
          expanded: true,
          auto: false,
          createdAtMs: Date.now(),
        },
      ],
    });
    void this.audit.append(makeEvent("group.create", { id, name }));
    return id;
  }

  async renameGroup(id: string, name: string): Promise<void> {
    const snapshot = this.store.current();
    const group = snapshot.groups.find((g) => g.id === id);
    if (!group) {
      return;
    }
    await this.store.apply(updateGroup(snapshot, id, { name, auto: false }));
    void this.audit.append(
      makeEvent("group.rename", { id, from: group.name, to: name }),
    );
  }

  async removeGroup(id: string): Promise<void> {
    const snapshot = this.store.current();
    if (snapshot.groups.length === 1) {
      // Always keep at least one group as a destination.
      return;
    }
    const fallback = snapshot.groups.find((g) => g.id !== id)?.id;
    if (!fallback) {
      return;
    }
    const reassigned = {
      ...snapshot,
      terminals: snapshot.terminals.map((t) =>
        t.groupId === id ? { ...t, groupId: fallback } : t,
      ),
      groups: snapshot.groups.filter((g) => g.id !== id),
    };
    await this.store.apply(reassigned);
    void this.audit.append(makeEvent("group.remove", { id }));
  }
}

// Helper: find an orphan record (in the store but no live terminal) whose
// name + cwd matches a freshly opened terminal — used to re-bind after
// window reload.
function matchExistingRecord(
  snapshot: StateSnapshot,
  terminal: vscode.Terminal,
  cwd: string | undefined,
): TerminalRecord | undefined {
  const liveKeys = new Set<string>();
  // We can't easily know live keys from here, but the runtime calls this
  // before binding so the most recent re-adopt may collide. The simple
  // rule: prefer a record with matching name + cwd that hasn't been bound
  // in this session yet.
  for (const record of snapshot.terminals) {
    if (liveKeys.has(record.key)) {
      continue;
    }
    if (record.name !== terminal.name) {
      continue;
    }
    if (cwd && record.cwd && record.cwd !== cwd) {
      continue;
    }
    return record;
  }
  return undefined;
}

function currentCwd(terminal: vscode.Terminal): string | undefined {
  const fromIntegration = terminal.shellIntegration?.cwd?.fsPath;
  if (fromIntegration && fromIntegration.length > 0) {
    return fromIntegration;
  }
  const options = terminal.creationOptions;
  if (
    options &&
    typeof options === "object" &&
    "cwd" in options &&
    options.cwd
  ) {
    const raw = options.cwd;
    if (typeof raw === "string") {
      return raw;
    }
    if (raw && typeof raw === "object" && "fsPath" in raw) {
      return (raw as vscode.Uri).fsPath;
    }
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// Convenience: build a friendly default name for a brand-new group whose
// cwd is known. Useful when the user clicks "new group" without typing.
export function defaultGroupNameForCwd(cwd: string | undefined): string {
  return autoGroupNameFromCwd(cwd ?? "");
}
