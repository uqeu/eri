// Persistence + in-memory state for the terminal organization layer.
// Keeps the *structural* metadata (groups, names, locks) — the terminals
// themselves are owned by VS Code.

import * as vscode from "vscode";

export type TerminalKey = string;
export type GroupId = string;

export interface GroupRecord {
  readonly id: GroupId;
  readonly name: string;
  readonly icon?: string;
  readonly expanded: boolean;
  readonly auto: boolean;
  readonly cwd?: string;
  readonly createdAtMs: number;
}

export interface TerminalRecord {
  readonly key: TerminalKey;
  readonly groupId: GroupId;
  readonly name: string;
  readonly nameLocked: boolean;
  readonly cwd?: string;
  readonly icon?: string;
  readonly createdAtMs: number;
}

export interface StateSnapshot {
  readonly groups: ReadonlyArray<GroupRecord>;
  readonly terminals: ReadonlyArray<TerminalRecord>;
}

interface RawSnapshot {
  readonly version?: number;
  readonly groups?: ReadonlyArray<Partial<GroupRecord>>;
  readonly terminals?: ReadonlyArray<Partial<TerminalRecord>>;
}

const STATE_VERSION = 1;
const STORAGE_PREFIX = "eri.terminals.state";

function storageKey(workspaceFsPath: string | undefined): string {
  return `${STORAGE_PREFIX}::${workspaceFsPath ?? "<global>"}`;
}

function emptySnapshot(): StateSnapshot {
  return { groups: [], terminals: [] };
}

// Pure helpers (immutable updates) ----------------------------------------

export function addGroup(
  snapshot: StateSnapshot,
  group: GroupRecord,
): StateSnapshot {
  if (snapshot.groups.some((g) => g.id === group.id)) {
    return snapshot;
  }
  return { ...snapshot, groups: [...snapshot.groups, group] };
}

export function updateGroup(
  snapshot: StateSnapshot,
  id: GroupId,
  patch: Partial<Omit<GroupRecord, "id">>,
): StateSnapshot {
  return {
    ...snapshot,
    groups: snapshot.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
  };
}

export function removeGroup(
  snapshot: StateSnapshot,
  id: GroupId,
): StateSnapshot {
  return {
    groups: snapshot.groups.filter((g) => g.id !== id),
    terminals: snapshot.terminals.filter((t) => t.groupId !== id),
  };
}

export function upsertTerminal(
  snapshot: StateSnapshot,
  record: TerminalRecord,
): StateSnapshot {
  const existing = snapshot.terminals.find((t) => t.key === record.key);
  if (existing) {
    return {
      ...snapshot,
      terminals: snapshot.terminals.map((t) =>
        t.key === record.key ? { ...t, ...record } : t,
      ),
    };
  }
  return { ...snapshot, terminals: [...snapshot.terminals, record] };
}

export function removeTerminal(
  snapshot: StateSnapshot,
  key: TerminalKey,
): StateSnapshot {
  return {
    ...snapshot,
    terminals: snapshot.terminals.filter((t) => t.key !== key),
  };
}

export function moveTerminal(
  snapshot: StateSnapshot,
  key: TerminalKey,
  groupId: GroupId,
): StateSnapshot {
  return {
    ...snapshot,
    terminals: snapshot.terminals.map((t) =>
      t.key === key ? { ...t, groupId } : t,
    ),
  };
}

export function findGroup(
  snapshot: StateSnapshot,
  id: GroupId,
): GroupRecord | undefined {
  return snapshot.groups.find((g) => g.id === id);
}

export function findTerminal(
  snapshot: StateSnapshot,
  key: TerminalKey,
): TerminalRecord | undefined {
  return snapshot.terminals.find((t) => t.key === key);
}

// Identity ----------------------------------------------------------------

// Stable-ish key for a terminal across reloads. VS Code reuses the
// processId only within a session, so we combine name + cwd + a per-session
// counter falling back gracefully.
export function terminalKeyFromNative(
  terminal: vscode.Terminal,
  counter: number,
): TerminalKey {
  const cwd = (terminal.shellIntegration?.cwd?.fsPath ?? "") || "";
  return `${terminal.name}::${cwd}::${counter}`;
}

export function generateGroupId(): GroupId {
  const rand = Math.random().toString(36).slice(2, 8);
  return `g_${Date.now().toString(36)}_${rand}`;
}

// Storage round-trip ------------------------------------------------------

export function serializeSnapshot(snapshot: StateSnapshot): RawSnapshot {
  return {
    version: STATE_VERSION,
    groups: snapshot.groups,
    terminals: snapshot.terminals,
  };
}

export function deserializeSnapshot(raw: unknown): StateSnapshot {
  if (!raw || typeof raw !== "object") {
    return emptySnapshot();
  }
  const candidate = raw as RawSnapshot;
  const groups = (candidate.groups ?? [])
    .map(toGroupRecord)
    .filter((g): g is GroupRecord => g !== null);
  const groupIds = new Set(groups.map((g) => g.id));
  const terminals = (candidate.terminals ?? [])
    .map(toTerminalRecord)
    .filter((t): t is TerminalRecord => t !== null && groupIds.has(t.groupId));
  return { groups, terminals };
}

function toGroupRecord(value: Partial<GroupRecord>): GroupRecord | null {
  if (!value || typeof value.id !== "string" || typeof value.name !== "string") {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    icon: typeof value.icon === "string" ? value.icon : undefined,
    expanded: value.expanded !== false,
    auto: value.auto === true,
    cwd: typeof value.cwd === "string" ? value.cwd : undefined,
    createdAtMs:
      typeof value.createdAtMs === "number" ? value.createdAtMs : Date.now(),
  };
}

function toTerminalRecord(
  value: Partial<TerminalRecord>,
): TerminalRecord | null {
  if (
    !value ||
    typeof value.key !== "string" ||
    typeof value.groupId !== "string" ||
    typeof value.name !== "string"
  ) {
    return null;
  }
  return {
    key: value.key,
    groupId: value.groupId,
    name: value.name,
    nameLocked: value.nameLocked === true,
    cwd: typeof value.cwd === "string" ? value.cwd : undefined,
    icon: typeof value.icon === "string" ? value.icon : undefined,
    createdAtMs:
      typeof value.createdAtMs === "number" ? value.createdAtMs : Date.now(),
  };
}

// Workspace-scoped store --------------------------------------------------

export class TerminalStateStore {
  private snapshot: StateSnapshot = emptySnapshot();
  private readonly emitter = new vscode.EventEmitter<StateSnapshot>();
  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly memento: vscode.Memento,
    private readonly workspaceFsPath: string | undefined,
  ) {
    this.snapshot = deserializeSnapshot(
      this.memento.get(storageKey(this.workspaceFsPath)),
    );
  }

  current(): StateSnapshot {
    return this.snapshot;
  }

  async apply(next: StateSnapshot): Promise<void> {
    if (next === this.snapshot) {
      return;
    }
    this.snapshot = next;
    await this.memento.update(
      storageKey(this.workspaceFsPath),
      serializeSnapshot(next),
    );
    this.emitter.fire(next);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
