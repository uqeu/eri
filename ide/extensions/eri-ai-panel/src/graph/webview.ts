import * as vscode from "vscode";
import { GraphClient, GraphEdge, GraphNode, SubgraphPayload } from "./api";

// Single global panel — reusing it keeps the layout stable across opens.
let panel: vscode.WebviewPanel | undefined;

interface RenderedNode {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

// Public entry: open (or reveal) the visualization for the most recent
// session. The layout is computed sidecar-free in TypeScript so the webview
// stays sandboxed without scripts.
export async function openGraphVisualization(
  client: GraphClient,
): Promise<void> {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Active);
    await refreshPanel(panel, client);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    "eri.graph.visualize",
    "eri · Graph",
    vscode.ViewColumn.Active,
    {
      enableScripts: false,
      retainContextWhenHidden: true,
    },
  );
  panel.onDidDispose(() => {
    panel = undefined;
  });
  await refreshPanel(panel, client);
}

async function refreshPanel(
  target: vscode.WebviewPanel,
  client: GraphClient,
): Promise<void> {
  let payload: SubgraphPayload = { nodes: [], edges: [] };
  let header = "(no activity in graph yet)";
  try {
    const sessions = await client.queryByKind("session", 1);
    if (sessions.length > 0) {
      const session = sessions[0];
      const sub = await client.traverse(session.id, 4, []);
      payload = sub;
      const ts = new Date(session.created_at_ms).toLocaleString();
      header = `Session ${truncate(session.id, 12)} · ${ts} · ${sub.nodes.length} nodes / ${sub.edges.length} edges`;
    }
  } catch (err) {
    header = `(failed to load graph: ${errorMessage(err)})`;
  }

  target.webview.html = renderHtml(header, payload);
}

function renderHtml(header: string, sub: SubgraphPayload): string {
  const svg = renderSvg(sub);
  const safeHeader = escapeHtml(header);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;" />
    <title>eri · Graph</title>
    <style>
      body {
        margin: 0;
        padding: 16px;
        background: #0b0d10;
        color: #e6edf3;
        font-family: var(--vscode-font-family, system-ui, sans-serif);
        font-size: 12px;
      }
      header {
        margin-bottom: 12px;
        opacity: 0.85;
      }
      .legend {
        margin: 8px 0 12px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .legend span {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border-radius: 4px;
        background: #14181d;
      }
      .swatch {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        display: inline-block;
      }
      .canvas {
        background: #0b0d10;
        border: 1px solid #1d232b;
        border-radius: 6px;
        overflow: auto;
      }
      svg {
        display: block;
      }
    </style>
  </head>
  <body>
    <header>eri · agent-memory graph · <strong>${safeHeader}</strong></header>
    <div class="legend">${legendHtml()}</div>
    <div class="canvas">${svg}</div>
  </body>
</html>`;
}

// Deterministic radial layout: each kind gets a fixed angle slice, sessions
// at the origin, everything else placed on concentric rings by ULID-encoded
// timestamp. The result is reproducible and doesn't require a JS engine in
// the webview (CSP keeps scripts disabled).
function renderSvg(sub: SubgraphPayload): string {
  if (sub.nodes.length === 0) {
    return `<svg viewBox="0 0 600 360" width="600" height="360"></svg>`;
  }

  const width = 720;
  const height = 480;
  const cx = width / 2;
  const cy = height / 2;
  const placed = layout(sub.nodes, cx, cy);
  const nodeById = new Map(placed.map((n) => [n.id, n]));

  const edges = sub.edges
    .map((edge) => renderEdge(edge, nodeById))
    .filter((s) => s.length > 0)
    .join("");
  const nodes = placed.map(renderNode).join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#586069" />
      </marker>
    </defs>
    ${edges}
    ${nodes}
  </svg>`;
}

function layout(
  nodes: ReadonlyArray<GraphNode>,
  cx: number,
  cy: number,
): RenderedNode[] {
  const buckets = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const bucket = buckets.get(node.kind);
    if (bucket) {
      bucket.push(node);
    } else {
      buckets.set(node.kind, [node]);
    }
  }

  const kinds = Array.from(buckets.keys()).sort();
  const result: RenderedNode[] = [];
  const baseRadius = 60;
  const ringStep = 36;

  kinds.forEach((kind, kindIndex) => {
    const items = buckets.get(kind) ?? [];
    items.sort((a, b) => a.created_at_ms - b.created_at_ms);
    if (kind === "session") {
      // Sessions sit at the origin (radius 0 if 1, else tight cluster).
      items.forEach((node, i) => {
        result.push({
          id: node.id,
          kind: node.kind,
          label: shortLabel(node),
          x: cx + (i % 2 === 0 ? -8 : 8) * i,
          y: cy,
        });
      });
      return;
    }
    const slice = (Math.PI * 2) / Math.max(1, kinds.length - (buckets.has("session") ? 1 : 0));
    const adjustedIndex =
      kindIndex - (kinds.indexOf("session") < kindIndex && buckets.has("session") ? 1 : 0);
    const angleBase = slice * adjustedIndex;
    items.forEach((node, i) => {
      const ring = Math.floor(i / 8);
      const radius = baseRadius + ringStep * ring + (i % 8) * 6;
      const offset = ((i % 8) / 8) * slice;
      const angle = angleBase + offset;
      result.push({
        id: node.id,
        kind: node.kind,
        label: shortLabel(node),
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
    });
  });
  return result;
}

function renderEdge(
  edge: GraphEdge,
  nodes: Map<string, RenderedNode>,
): string {
  const src = nodes.get(edge.src);
  const dst = nodes.get(edge.dst);
  if (!src || !dst) {
    return "";
  }
  const color = edgeColor(edge.kind);
  return `<line x1="${src.x.toFixed(1)}" y1="${src.y.toFixed(1)}" x2="${dst.x.toFixed(1)}" y2="${dst.y.toFixed(1)}" stroke="${color}" stroke-width="1" opacity="0.55" marker-end="url(#arrow)"><title>${escapeHtml(edge.kind)}</title></line>`;
}

function renderNode(node: RenderedNode): string {
  const color = nodeColor(node.kind);
  const label = escapeHtml(node.label);
  return `<g><circle cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="6" fill="${color}" stroke="#0b0d10" stroke-width="1.5"><title>${escapeHtml(node.kind)} · ${escapeHtml(node.id)}</title></circle><text x="${(node.x + 9).toFixed(1)}" y="${(node.y + 3).toFixed(1)}" fill="#e6edf3" font-size="10" font-family="system-ui">${label}</text></g>`;
}

function shortLabel(node: GraphNode): string {
  const body = node.body;
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    for (const key of ["text", "label", "summary", "name", "path", "sha"]) {
      const value = obj[key];
      if (typeof value === "string" && value.length > 0) {
        return truncate(value, 32);
      }
    }
  }
  return node.kind;
}

const NODE_COLORS: Record<string, string> = {
  prompt: "#7ee787",
  voice_transcript: "#79c0ff",
  intent: "#d2a8ff",
  model_call: "#ffa657",
  model_response: "#f0883e",
  edit_proposed: "#a5d6ff",
  edit_applied: "#3fb950",
  edit_rejected: "#f85149",
  file_touched: "#8b949e",
  symbol: "#b1bac4",
  checkpoint: "#bc8cff",
  error: "#ff7b72",
  note: "#ffea7f",
  session: "#58a6ff",
};

const EDGE_COLORS: Record<string, string> = {
  caused_by: "#7ee787",
  references: "#a5d6ff",
  follows: "#8b949e",
  belongs_to_session: "#58a6ff",
  derived_from: "#bc8cff",
  undid: "#f85149",
  related_to: "#d2a8ff",
};

function nodeColor(kind: string): string {
  return NODE_COLORS[kind] ?? "#8b949e";
}

function edgeColor(kind: string): string {
  return EDGE_COLORS[kind] ?? "#586069";
}

function legendHtml(): string {
  return Object.entries(NODE_COLORS)
    .map(
      ([kind, color]) =>
        `<span><span class="swatch" style="background:${color}"></span>${escapeHtml(kind)}</span>`,
    )
    .join("");
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(input: string, max: number): string {
  if (input.length <= max) {
    return input;
  }
  return input.slice(0, max - 1) + "…";
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
