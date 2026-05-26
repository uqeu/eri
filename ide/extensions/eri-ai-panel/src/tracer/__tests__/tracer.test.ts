// Pure unit tests for the tracer's URL / args parsing + sandbox naming
// + markdown rendering. The git clone + sidecar paths are integration-
// level and not exercised here (they need network + a live sidecar).

import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import {
  looksLikeRepoUrl,
  parseTracerArgs,
  renderTracerMarkdown,
  sandboxPathFor,
  TracerResult,
} from "../pure";

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  fail ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("tracer.test.ts");

run("parses github url + query", () => {
  const r = parseTracerArgs(
    "https://github.com/anthropics/anthropic-sdk-python what is the streaming API?",
  );
  assert.deepEqual(r, {
    url: "https://github.com/anthropics/anthropic-sdk-python",
    query: "what is the streaming API?",
  });
});

run("returns null for missing query", () => {
  assert.equal(parseTracerArgs("https://github.com/foo/bar"), null);
  assert.equal(parseTracerArgs(""), null);
  assert.equal(parseTracerArgs("   "), null);
});

run("looksLikeRepoUrl recognises common hosts", () => {
  assert.equal(looksLikeRepoUrl("https://github.com/foo/bar"), true);
  assert.equal(looksLikeRepoUrl("https://gitlab.com/foo/bar"), true);
  assert.equal(looksLikeRepoUrl("https://bitbucket.org/foo/bar"), true);
  assert.equal(looksLikeRepoUrl("https://codeberg.org/foo/bar"), true);
  assert.equal(looksLikeRepoUrl("git@github.com:foo/bar.git"), true);
  assert.equal(looksLikeRepoUrl("https://example.com/foo"), false);
  assert.equal(looksLikeRepoUrl("rm -rf /"), false);
});

run("sandboxPathFor lives under HOME/.eri/sandboxes", () => {
  const p = sandboxPathFor("https://github.com/foo/bar");
  assert.ok(p.startsWith(path.join(os.homedir(), ".eri", "sandboxes")));
});

run("sandboxPathFor is stable + collision-resistant", () => {
  const a = sandboxPathFor("https://github.com/foo/bar");
  const b = sandboxPathFor("https://github.com/foo/bar");
  const c = sandboxPathFor("https://github.com/foo/baz");
  assert.equal(a, b);
  assert.notEqual(a, c);
});

run("renderTracerMarkdown sorts hits by descending score", () => {
  const result: TracerResult = {
    url: "https://github.com/foo/bar",
    query: "auth",
    sandboxPath: "/tmp/x",
    hits: [
      { path: "src/a.ts", line_start: 1, line_end: 2, content: "lowscore", score: 0.1 },
      { path: "src/b.ts", line_start: 3, line_end: 4, content: "highscore", score: 0.9 },
    ],
    cleanup: async () => {},
  };
  const md = renderTracerMarkdown(result);
  const highIdx = md.indexOf("src/b.ts");
  const lowIdx = md.indexOf("src/a.ts");
  assert.ok(highIdx >= 0 && lowIdx >= 0);
  assert.ok(highIdx < lowIdx, "high score should render before low score");
});

run("renderTracerMarkdown renders empty marker on no hits", () => {
  const result: TracerResult = {
    url: "https://github.com/foo/bar",
    query: "x",
    sandboxPath: "/tmp/x",
    hits: [],
    cleanup: async () => {},
  };
  assert.ok(renderTracerMarkdown(result).includes("_No hits._"));
});

console.log("done.");
