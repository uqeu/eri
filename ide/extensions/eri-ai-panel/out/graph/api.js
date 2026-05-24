"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GraphClient = void 0;
exports.currentWorkspaceFsPath = currentWorkspaceFsPath;
const vscode = require("vscode");
// Thin wrapper around the sidecar JSON-RPC surface for `eri/graph/*`. Lives
// here (vs. in each consumer) so the wire format only needs to be touched
// in one place when the schema evolves.
class GraphClient {
    getSidecar;
    getWorkspace;
    constructor(getSidecar, getWorkspace) {
        this.getSidecar = getSidecar;
        this.getWorkspace = getWorkspace;
    }
    require() {
        const sidecar = this.getSidecar();
        const workspace = this.getWorkspace();
        if (!sidecar || !workspace) {
            throw new Error("sidecar offline or no workspace open");
        }
        return { sidecar, workspace };
    }
    async insertNode(kind, body, tags) {
        const { sidecar, workspace } = this.require();
        const out = await sidecar.request("eri/graph/insert_node", { workspace, kind, body, tags });
        return out.id;
    }
    async insertEdge(src, dst, kind, extra) {
        const { sidecar, workspace } = this.require();
        const out = await sidecar.request("eri/graph/insert_edge", {
            workspace,
            src,
            dst,
            kind,
            ...(extra?.weight !== undefined ? { weight: extra.weight } : {}),
            ...(extra?.metadata !== undefined ? { metadata: extra.metadata } : {}),
        });
        return out.id;
    }
    async get(id) {
        const { sidecar, workspace } = this.require();
        const out = await sidecar.request("eri/graph/get", { workspace, id });
        return out.node ?? null;
    }
    async neighbors(id, options) {
        const { sidecar, workspace } = this.require();
        const out = await sidecar.request("eri/graph/neighbors", {
            workspace,
            id,
            ...(options?.edgeKind ? { edgeKind: options.edgeKind } : {}),
            ...(options?.direction ? { direction: options.direction } : {}),
        });
        return out.items ?? [];
    }
    async traverse(root, maxDepth, edgeKinds) {
        const { sidecar, workspace } = this.require();
        return await sidecar.request("eri/graph/traverse", {
            workspace,
            root,
            maxDepth,
            edgeKinds,
        });
    }
    async queryByKind(kind, limit) {
        const { sidecar, workspace } = this.require();
        const out = await sidecar.request("eri/graph/query_kind", { workspace, kind, ...(limit !== undefined ? { limit } : {}) });
        return out.nodes ?? [];
    }
    async search(q, limit) {
        const { sidecar, workspace } = this.require();
        const out = await sidecar.request("eri/graph/search", { workspace, q, ...(limit !== undefined ? { limit } : {}) });
        return out.nodes ?? [];
    }
    async stats() {
        const { sidecar, workspace } = this.require();
        return await sidecar.request("eri/graph/stats", { workspace });
    }
    async export() {
        const { sidecar, workspace } = this.require();
        const out = await sidecar.request("eri/graph/export", {
            workspace,
        });
        return out.path;
    }
}
exports.GraphClient = GraphClient;
// Helper: read the first workspace folder fs path, or undefined if none open.
function currentWorkspaceFsPath() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return undefined;
    }
    return folders[0].uri.fsPath;
}
//# sourceMappingURL=api.js.map