import * as vscode from "vscode";
import { Sidecar } from "../sidecar";

// Wire types — these mirror eri_graph's public API as serialized by serde.
export interface GraphNode {
  readonly id: string;
  readonly kind: string;
  readonly created_at_ms: number;
  readonly body: unknown;
  readonly tags: ReadonlyArray<string>;
}

export interface GraphEdge {
  readonly id: string;
  readonly src: string;
  readonly dst: string;
  readonly kind: string;
  readonly weight: number;
  readonly created_at_ms: number;
  readonly metadata: unknown;
}

export interface NeighborItem {
  readonly edge: GraphEdge;
  readonly node: GraphNode;
}

export interface GraphStats {
  readonly nodes: number;
  readonly edges: number;
  readonly sessions: number;
  readonly lastActivityMs: number;
}

export interface SubgraphPayload {
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly edges: ReadonlyArray<GraphEdge>;
}

export type Direction = "out" | "in" | "both";

// Thin wrapper around the sidecar JSON-RPC surface for `eri/graph/*`. Lives
// here (vs. in each consumer) so the wire format only needs to be touched
// in one place when the schema evolves.
export class GraphClient {
  constructor(
    private readonly getSidecar: () => Sidecar | null,
    private readonly getWorkspace: () => string | undefined,
  ) {}

  private require(): { sidecar: Sidecar; workspace: string } {
    const sidecar = this.getSidecar();
    const workspace = this.getWorkspace();
    if (!sidecar || !workspace) {
      throw new Error("sidecar offline or no workspace open");
    }
    return { sidecar, workspace };
  }

  async insertNode(
    kind: string,
    body: unknown,
    tags?: ReadonlyArray<string>,
  ): Promise<string> {
    const { sidecar, workspace } = this.require();
    const out = await sidecar.request<{ id: string }>(
      "eri/graph/insert_node",
      { workspace, kind, body, tags },
    );
    return out.id;
  }

  async insertEdge(
    src: string,
    dst: string,
    kind: string,
    extra?: { weight?: number; metadata?: unknown },
  ): Promise<string> {
    const { sidecar, workspace } = this.require();
    const out = await sidecar.request<{ id: string }>(
      "eri/graph/insert_edge",
      {
        workspace,
        src,
        dst,
        kind,
        ...(extra?.weight !== undefined ? { weight: extra.weight } : {}),
        ...(extra?.metadata !== undefined ? { metadata: extra.metadata } : {}),
      },
    );
    return out.id;
  }

  async get(id: string): Promise<GraphNode | null> {
    const { sidecar, workspace } = this.require();
    const out = await sidecar.request<{ node: GraphNode | null }>(
      "eri/graph/get",
      { workspace, id },
    );
    return out.node ?? null;
  }

  async neighbors(
    id: string,
    options?: { edgeKind?: string; direction?: Direction },
  ): Promise<ReadonlyArray<NeighborItem>> {
    const { sidecar, workspace } = this.require();
    const out = await sidecar.request<{ items: NeighborItem[] }>(
      "eri/graph/neighbors",
      {
        workspace,
        id,
        ...(options?.edgeKind ? { edgeKind: options.edgeKind } : {}),
        ...(options?.direction ? { direction: options.direction } : {}),
      },
    );
    return out.items ?? [];
  }

  async traverse(
    root: string,
    maxDepth: number,
    edgeKinds: ReadonlyArray<string>,
  ): Promise<SubgraphPayload> {
    const { sidecar, workspace } = this.require();
    return await sidecar.request<SubgraphPayload>("eri/graph/traverse", {
      workspace,
      root,
      maxDepth,
      edgeKinds,
    });
  }

  async queryByKind(
    kind: string,
    limit?: number,
  ): Promise<ReadonlyArray<GraphNode>> {
    const { sidecar, workspace } = this.require();
    const out = await sidecar.request<{ nodes: GraphNode[] }>(
      "eri/graph/query_kind",
      { workspace, kind, ...(limit !== undefined ? { limit } : {}) },
    );
    return out.nodes ?? [];
  }

  async search(q: string, limit?: number): Promise<ReadonlyArray<GraphNode>> {
    const { sidecar, workspace } = this.require();
    const out = await sidecar.request<{ nodes: GraphNode[] }>(
      "eri/graph/search",
      { workspace, q, ...(limit !== undefined ? { limit } : {}) },
    );
    return out.nodes ?? [];
  }

  async stats(): Promise<GraphStats> {
    const { sidecar, workspace } = this.require();
    return await sidecar.request<GraphStats>("eri/graph/stats", { workspace });
  }

  async export(): Promise<string> {
    const { sidecar, workspace } = this.require();
    const out = await sidecar.request<{ path: string }>("eri/graph/export", {
      workspace,
    });
    return out.path;
  }
}

// Helper: read the first workspace folder fs path, or undefined if none open.
export function currentWorkspaceFsPath(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  return folders[0].uri.fsPath;
}
