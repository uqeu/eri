// `/tracer <github-url> <query>` — Nia parity (Phase 21a).
//
// Clones a remote repo into an ephemeral sandbox under
// `~/.eri/sandboxes/<sha>/`, runs the sidecar's `eri/index/sync` over
// it, executes `eri/index/search` with the user's query, then deletes
// the sandbox once the user dismisses the result panel. The
// resulting search hits are streamed into a markdown buffer + shown
// in a webview so the user can click through to source lines.
//
// Discipline:
//   - Sandbox lives under HOME (never inside the user's workspace) so
//     a misbehaving git push from inside the sandbox can't accidentally
//     touch the user's repo.
//   - Shallow clone (--depth=1) — we're answering a search query, not
//     reproducing history.
//   - Per-tracer lock: only one tracer per URL at a time. Repeated
//     /tracer for the same URL within the same session reuses the
//     already-cloned sandbox until dismissed.
//   - On any error, the sandbox is cleaned up. The user sees a clear
//     message + the option to retry.

import * as fs from "node:fs/promises";
import { spawn } from "node:child_process";
import * as vscode from "vscode";
import type { Sidecar } from "../sidecar";
import {
  looksLikeRepoUrl,
  renderTracerMarkdown,
  sandboxPathFor,
  sandboxRoot,
  SearchHit,
  TracerResult,
} from "./pure";

export {
  looksLikeRepoUrl,
  parseTracerArgs,
  renderTracerMarkdown,
  sandboxPathFor,
} from "./pure";
export type { TracerResult, SearchHit } from "./pure";

interface TracerRunOptions {
  readonly url: string;
  readonly query: string;
  readonly sidecar: Sidecar;
}

export async function runTracer(opts: TracerRunOptions): Promise<TracerResult> {
  const { url, query, sidecar } = opts;
  if (!looksLikeRepoUrl(url)) {
    throw new Error(
      `unrecognised git URL: ${url}. Try github.com / gitlab.com / bitbucket.org.`,
    );
  }
  const sandbox = sandboxPathFor(url);
  const cleanup = async (): Promise<void> => {
    try {
      await fs.rm(sandbox, { recursive: true, force: true });
    } catch (err) {
      console.warn("[eri /tracer] cleanup failed", err);
    }
  };

  try {
    await fs.mkdir(sandboxRoot(), { recursive: true });
    const existing = await dirExists(sandbox);
    if (!existing) {
      await runGitClone(url, sandbox);
    }
    await sidecar.request("eri/index/sync", { workspace: sandbox });
    const result = await sidecar.request<{ results: SearchHit[] }>(
      "eri/index/search",
      { workspace: sandbox, query, topK: 20 },
    );
    return {
      url,
      query,
      sandboxPath: sandbox,
      hits: result.results ?? [],
      cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function runGitClone(url: string, dest: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // spawn with an args array — no shell interpolation, so a crafted
    // URL is passed as a single argv slot to git directly.
    const child = spawn(
      "git",
      ["clone", "--depth", "1", "--no-tags", url, dest],
      { stdio: "ignore" },
    );
    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git clone exited with code ${code}`));
    });
  });
}

export async function showTracerResultDocument(result: TracerResult): Promise<void> {
  const md = renderTracerMarkdown(result);
  const doc = await vscode.workspace.openTextDocument({
    content: md,
    language: "markdown",
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}
