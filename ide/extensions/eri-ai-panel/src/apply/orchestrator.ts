import * as vscode from "vscode";
import { Sidecar } from "../sidecar";
import { applySearchReplace, ParsedBlock } from "./searchReplace";

export type ApplyKind = "created" | "modified" | "deleted" | "replaced";

export interface AppliedFile {
  readonly path: string;
  readonly kind: ApplyKind;
  readonly bytesBefore: number;
  readonly bytesAfter: number;
}

export interface FailedFile {
  readonly path: string;
  readonly reason: string;
  readonly detail?: string;
}

export interface ApplyResult {
  readonly applied: ReadonlyArray<AppliedFile>;
  readonly failed: ReadonlyArray<FailedFile>;
  readonly checkpointId: string | null;
}

export interface EditPreview {
  readonly before: string;
  readonly after: string;
  readonly hasPreview: boolean;
  readonly reason?: string;
}

export interface PendingEdit {
  readonly id: string;
  readonly path: string;
  readonly absolutePath: string;
  readonly search: string;
  readonly replace: string;
  readonly preview: EditPreview;
  accepted: boolean | null;
}

interface ParseResponse {
  readonly edits?: ReadonlyArray<{
    path?: string;
    search?: string;
    replace?: string;
  }>;
}

interface RunResponse {
  readonly applied?: ReadonlyArray<{
    path?: string;
    kind?: string;
    bytesBefore?: number;
    bytesAfter?: number;
  }>;
  readonly failed?: ReadonlyArray<{
    path?: string;
    reason?: string;
    detail?: string;
  }>;
}

interface CheckpointResponse {
  readonly id?: string;
}

const KNOWN_KINDS: ReadonlySet<ApplyKind> = new Set([
  "created",
  "modified",
  "deleted",
  "replaced",
]);

export class ApplyOrchestrator {
  private lastCheckpointId: string | null = null;
  private lastResult: ApplyResult | null = null;
  private editCounter = 0;

  constructor(private readonly getSidecar: () => Sidecar | null) {}

  // Parse model output through the sidecar, then build per-edit JS previews.
  async stage(modelOutput: string): Promise<PendingEdit[]> {
    const sidecar = this.getSidecar();
    if (!sidecar) {
      throw new Error("eri sidecar not running");
    }
    const root = this.workspaceRoot();
    const parsed = await sidecar.request<ParseResponse>("eri/apply/parse", {
      text: modelOutput,
    });
    const blocks: ParsedBlock[] = (parsed.edits ?? [])
      .filter(
        (e): e is { path: string; search: string; replace: string } =>
          typeof e.path === "string" &&
          typeof e.search === "string" &&
          typeof e.replace === "string",
      )
      .map((e) => ({ path: e.path, search: e.search, replace: e.replace }));

    const out: PendingEdit[] = [];
    // Track running buffer per file so multi-block previews compound.
    const buffers = new Map<string, string>();
    for (const block of blocks) {
      const abs = this.resolveAbsolute(root, block.path);
      const before = buffers.get(block.path) ?? (await readFileText(abs));
      const outcome = applySearchReplace(before, block.search, block.replace);
      const preview: EditPreview = outcome
        ? { before, after: outcome.after, hasPreview: true }
        : {
            before,
            after: before,
            hasPreview: false,
            reason: "Could not locate SEARCH in current file — sidecar will retry on apply.",
          };
      if (outcome) {
        buffers.set(block.path, outcome.after);
      }
      out.push({
        id: `edit-${++this.editCounter}`,
        path: block.path,
        absolutePath: abs,
        search: block.search,
        replace: block.replace,
        preview,
        accepted: null,
      });
    }
    return out;
  }

  // Apply the accepted edits via the sidecar; auto-create a checkpoint first.
  async commit(accepted: ReadonlyArray<PendingEdit>): Promise<ApplyResult> {
    const sidecar = this.getSidecar();
    if (!sidecar) {
      throw new Error("eri sidecar not running");
    }
    if (accepted.length === 0) {
      const empty: ApplyResult = { applied: [], failed: [], checkpointId: null };
      this.lastResult = empty;
      return empty;
    }
    const root = this.workspaceRoot();
    const checkpointId = await this.createCheckpoint(sidecar, root);

    const response = await sidecar.request<RunResponse>("eri/apply/run", {
      root,
      edits: accepted.map((edit) => ({
        path: edit.path,
        search: edit.search,
        replace: edit.replace,
      })),
    });

    const applied: AppliedFile[] = (response.applied ?? [])
      .filter((a): a is { path: string; kind: string; bytesBefore: number; bytesAfter: number } =>
        typeof a.path === "string" &&
        typeof a.kind === "string" &&
        typeof a.bytesBefore === "number" &&
        typeof a.bytesAfter === "number",
      )
      .map((a) => ({
        path: a.path,
        kind: KNOWN_KINDS.has(a.kind as ApplyKind) ? (a.kind as ApplyKind) : "modified",
        bytesBefore: a.bytesBefore,
        bytesAfter: a.bytesAfter,
      }));

    const failed: FailedFile[] = (response.failed ?? [])
      .filter((f): f is { path: string; reason: string; detail?: string } =>
        typeof f.path === "string" && typeof f.reason === "string",
      )
      .map((f) => ({
        path: f.path,
        reason: f.reason,
        ...(typeof f.detail === "string" ? { detail: f.detail } : {}),
      }));

    const result: ApplyResult = { applied, failed, checkpointId };
    this.lastResult = result;
    return result;
  }

  async revert(checkpointId: string): Promise<void> {
    const sidecar = this.getSidecar();
    if (!sidecar) {
      throw new Error("eri sidecar not running");
    }
    const root = this.workspaceRoot();
    await sidecar.request("eri/checkpoints/restore", {
      workspace: root,
      id: checkpointId,
      force: true,
    });
  }

  lastCheckpoint(): string | null {
    return this.lastCheckpointId;
  }

  lastBatch(): ApplyResult | null {
    return this.lastResult;
  }

  private async createCheckpoint(sidecar: Sidecar, root: string): Promise<string | null> {
    try {
      const cp = await sidecar.request<CheckpointResponse>("eri/checkpoints/create", {
        workspace: root,
        label: "Before edit",
      });
      const id = typeof cp.id === "string" ? cp.id : null;
      this.lastCheckpointId = id;
      return id;
    } catch {
      // Checkpoints are a nice-to-have for revert; failure shouldn't block apply.
      this.lastCheckpointId = null;
      return null;
    }
  }

  private workspaceRoot(): string {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error("eri: no workspace folder open");
    }
    return folder.uri.fsPath;
  }

  private resolveAbsolute(root: string, relPath: string): string {
    return vscode.Uri.joinPath(vscode.Uri.file(root), relPath).fsPath;
  }
}

async function readFileText(absolutePath: string): Promise<string> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePath));
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return "";
  }
}
