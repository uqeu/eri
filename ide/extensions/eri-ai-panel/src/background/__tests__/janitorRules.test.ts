// Tests for the IDE-side glob matcher used by the Janitor rules
// watcher to fire commands on save events. Mirrors the sidecar's
// matcher so the rule fires identically on both sides.

import { matchesSaveGlob } from "../saveGlob";
import * as assert from "node:assert/strict";

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

console.log("janitorRules.test.ts");

run("ignores non-save triggers", () => {
  assert.equal(matchesSaveGlob("idle:5m", "anything"), false);
  assert.equal(matchesSaveGlob("not-a-trigger", "anything"), false);
});

run("matches double-star globs", () => {
  assert.equal(matchesSaveGlob("save:**/*.sql", "migrations/001.sql"), true);
  assert.equal(matchesSaveGlob("save:**/*.sql", "001.sql"), true);
  assert.equal(matchesSaveGlob("save:**/*.sql", "src/foo.ts"), false);
});

run("blocks slashes through single-star", () => {
  assert.equal(matchesSaveGlob("save:src/*.ts", "src/foo.ts"), true);
  assert.equal(matchesSaveGlob("save:src/*.ts", "src/sub/foo.ts"), false);
});

run("matches exact paths", () => {
  assert.equal(matchesSaveGlob("save:README.md", "README.md"), true);
  assert.equal(matchesSaveGlob("save:README.md", "docs/README.md"), false);
});

run("question mark matches one non-slash character", () => {
  assert.equal(matchesSaveGlob("save:foo?.ts", "foo1.ts"), true);
  assert.equal(matchesSaveGlob("save:foo?.ts", "foo12.ts"), false);
  assert.equal(matchesSaveGlob("save:foo?.ts", "foo/1.ts"), false);
});

console.log("done.");
