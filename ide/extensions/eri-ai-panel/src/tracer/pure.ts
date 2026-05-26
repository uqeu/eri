// Pure helpers for the /tracer flow — extracted from the main module
// so unit tests can import them without pulling `vscode`.

import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";

export interface SearchHit {
  readonly path: string;
  readonly line_start: number;
  readonly line_end: number;
  readonly content: string;
  readonly score: number;
}

export interface TracerResult {
  readonly url: string;
  readonly query: string;
  readonly sandboxPath: string;
  readonly hits: SearchHit[];
  readonly cleanup: () => Promise<void>;
}

const SANDBOX_ROOT = path.join(os.homedir(), ".eri", "sandboxes");

export function parseTracerArgs(args: string): { url: string; query: string } | null {
  const trimmed = args.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\S+)\s+(.+)$/);
  if (!match) return null;
  const url = match[1] ?? "";
  const query = (match[2] ?? "").trim();
  if (!url || !query) return null;
  return { url, query };
}

export function sandboxPathFor(url: string): string {
  const sha = crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
  return path.join(SANDBOX_ROOT, sha);
}

export function sandboxRoot(): string {
  return SANDBOX_ROOT;
}

export function looksLikeRepoUrl(url: string): boolean {
  return (
    /^https:\/\/(github|gitlab)\.com\//.test(url) ||
    /^https:\/\/codeberg\.org\//.test(url) ||
    /^https:\/\/bitbucket\.org\//.test(url) ||
    /^git@github\.com:/.test(url)
  );
}

export function renderTracerMarkdown(result: TracerResult): string {
  const lines: string[] = [];
  lines.push(`# Tracer: ${result.query}`);
  lines.push("");
  lines.push(`Repo: ${result.url}`);
  lines.push(`Sandbox: \`${result.sandboxPath}\``);
  lines.push("");
  if (result.hits.length === 0) {
    lines.push("_No hits._");
    return lines.join("\n");
  }
  const sorted = [...result.hits].sort((a, b) => b.score - a.score);
  for (const hit of sorted) {
    lines.push(
      `## ${hit.path}:${hit.line_start}-${hit.line_end} (score: ${hit.score.toFixed(2)})`,
    );
    lines.push("");
    lines.push("```");
    lines.push(hit.content.trim());
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}
