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

const ALLOWED_HTTPS_HOSTS = new Set<string>([
  "github.com",
  "gitlab.com",
  "codeberg.org",
  "bitbucket.org",
]);

export function looksLikeRepoUrl(url: string): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  // Anything that could be mistaken for a CLI flag is rejected outright
  // so a malformed allowlist regex can never expose `git clone` to argv
  // flag smuggling (e.g. `--upload-pack=...`).
  if (url.startsWith("-")) return false;
  // SSH shorthand — only github is supported. The path component must
  // start with an alphanumeric char so a malicious "git@github.com:--foo"
  // can't sneak past on the SSH branch.
  if (/^git@github\.com:[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(url)) return true;
  // HTTPS — parse strictly with new URL() and check the exact hostname
  // against an allowlist (not a substring match).
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (!ALLOWED_HTTPS_HOSTS.has(parsed.hostname)) return false;
    if (parsed.username !== "" || parsed.password !== "") return false;
    return parsed.pathname.length > 1;
  } catch {
    return false;
  }
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
