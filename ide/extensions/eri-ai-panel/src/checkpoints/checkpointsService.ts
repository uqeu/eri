import { execFile } from "child_process";
import { promisify } from "util";
import * as vscode from "vscode";
import { Sidecar } from "../sidecar";

const execFileAsync = promisify(execFile);

export interface Checkpoint {
  readonly id: string;
  readonly sha: string;
  readonly createdAtMs: number;
  readonly label: string;
}

export type FileChangeKind = "added" | "modified" | "deleted" | "renamed";

export interface CheckpointFileChange {
  readonly path: string;
  readonly kind: FileChangeKind;
  readonly added: number;
  readonly removed: number;
}

export interface CheckpointShow {
  readonly filesChanged: ReadonlyArray<CheckpointFileChange>;
}

export interface RestoreResult {
  readonly filesRestored: ReadonlyArray<string>;
  readonly filesSkipped: ReadonlyArray<string>;
}

export interface PruneResult {
  readonly pruned: number;
}

type SidecarAccessor = () => Sidecar | null;

function isFileChangeKind(value: unknown): value is FileChangeKind {
  return (
    value === "added" || value === "modified" || value === "deleted" || value === "renamed"
  );
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function parseCheckpoint(raw: unknown): Checkpoint | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const id = asString(obj.id, "");
  const sha = asString(obj.sha, "");
  if (!id || !sha) {
    return null;
  }
  return {
    id,
    sha,
    createdAtMs: asNumber(obj.createdAtMs, 0),
    label: asString(obj.label, ""),
  };
}

function parseFileChange(raw: unknown): CheckpointFileChange | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const path = asString(obj.path, "");
  if (!path) {
    return null;
  }
  const kind = isFileChangeKind(obj.kind) ? obj.kind : "modified";
  return {
    path,
    kind,
    added: asNumber(obj.added, 0),
    removed: asNumber(obj.removed, 0),
  };
}

export class CheckpointsService {
  constructor(private readonly getSidecar: SidecarAccessor) {}

  private requireSidecar(): Sidecar {
    const sidecar = this.getSidecar();
    if (!sidecar) {
      throw new Error("eri sidecar is not running");
    }
    return sidecar;
  }

  async list(): Promise<ReadonlyArray<Checkpoint>> {
    const sidecar = this.requireSidecar();
    const result = await sidecar.request<{ checkpoints?: unknown }>(
      "eri/checkpoints/list",
      {},
    );
    if (!Array.isArray(result?.checkpoints)) {
      return [];
    }
    const parsed: Checkpoint[] = [];
    for (const item of result.checkpoints) {
      const cp = parseCheckpoint(item);
      if (cp) {
        parsed.push(cp);
      }
    }
    parsed.sort((a, b) => b.createdAtMs - a.createdAtMs);
    return parsed;
  }

  async show(id: string): Promise<CheckpointShow> {
    const sidecar = this.requireSidecar();
    const result = await sidecar.request<{ filesChanged?: unknown }>(
      "eri/checkpoints/show",
      { id },
    );
    if (!Array.isArray(result?.filesChanged)) {
      return { filesChanged: [] };
    }
    const parsed: CheckpointFileChange[] = [];
    for (const item of result.filesChanged) {
      const change = parseFileChange(item);
      if (change) {
        parsed.push(change);
      }
    }
    return { filesChanged: parsed };
  }

  async restore(id: string, options: { force: boolean }): Promise<RestoreResult> {
    const sidecar = this.requireSidecar();
    const result = await sidecar.request<{
      filesRestored?: unknown;
      filesSkipped?: unknown;
    }>("eri/checkpoints/restore", { id, force: options.force });
    return {
      filesRestored: asStringArray(result?.filesRestored),
      filesSkipped: asStringArray(result?.filesSkipped),
    };
  }

  async create(label: string): Promise<Checkpoint> {
    const sidecar = this.requireSidecar();
    const result = await sidecar.request<unknown>("eri/checkpoints/create", { label });
    const parsed = parseCheckpoint(result);
    if (!parsed) {
      throw new Error("sidecar returned an invalid checkpoint payload");
    }
    return parsed;
  }

  async delete(id: string): Promise<void> {
    const sidecar = this.requireSidecar();
    await sidecar.request<{ ok?: boolean }>("eri/checkpoints/delete", { id });
  }

  async prune(keep: number): Promise<PruneResult> {
    const sidecar = this.requireSidecar();
    const result = await sidecar.request<{ pruned?: unknown }>(
      "eri/checkpoints/prune",
      { keep },
    );
    return { pruned: asNumber(result?.pruned, 0) };
  }
}

/**
 * Read the contents of a file at a given git revision via `git show <sha>:<path>`.
 *
 * Side-effect-free: never writes to disk, never mutates refs. The output is
 * placed into an untitled in-memory document by the caller.
 */
export async function readFileAtRevision(
  cwd: string,
  sha: string,
  filePath: string,
): Promise<string> {
  if (!/^[a-f0-9]{4,64}$/i.test(sha)) {
    throw new Error(`invalid sha: ${sha}`);
  }
  // Use execFile (not exec) and pass args as array — no shell, no injection surface.
  const { stdout } = await execFileAsync(
    "git",
    ["show", `${sha}:${filePath}`],
    {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      encoding: "utf8",
    },
  );
  return stdout;
}

export function resolveWorkspaceCwd(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return null;
  }
  return folders[0]?.uri.fsPath ?? null;
}
