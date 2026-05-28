"use strict";
// Tests for the IDE-side glob matcher used by the Janitor rules
// watcher to fire commands on save events. Mirrors the sidecar's
// matcher so the rule fires identically on both sides.
Object.defineProperty(exports, "__esModule", { value: true });
const saveGlob_1 = require("../saveGlob");
const assert = require("node:assert/strict");
function run(name, fn) {
    try {
        fn();
        console.log(`  ok   ${name}`);
    }
    catch (err) {
        console.error(`  fail ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}
console.log("janitorRules.test.ts");
run("ignores non-save triggers", () => {
    assert.equal((0, saveGlob_1.matchesSaveGlob)("idle:5m", "anything"), false);
    assert.equal((0, saveGlob_1.matchesSaveGlob)("not-a-trigger", "anything"), false);
});
run("matches double-star globs", () => {
    assert.equal((0, saveGlob_1.matchesSaveGlob)("save:**/*.sql", "migrations/001.sql"), true);
    assert.equal((0, saveGlob_1.matchesSaveGlob)("save:**/*.sql", "001.sql"), true);
    assert.equal((0, saveGlob_1.matchesSaveGlob)("save:**/*.sql", "src/foo.ts"), false);
});
run("blocks slashes through single-star", () => {
    assert.equal((0, saveGlob_1.matchesSaveGlob)("save:src/*.ts", "src/foo.ts"), true);
    assert.equal((0, saveGlob_1.matchesSaveGlob)("save:src/*.ts", "src/sub/foo.ts"), false);
});
run("matches exact paths", () => {
    assert.equal((0, saveGlob_1.matchesSaveGlob)("save:README.md", "README.md"), true);
    assert.equal((0, saveGlob_1.matchesSaveGlob)("save:README.md", "docs/README.md"), false);
});
run("question mark matches one non-slash character", () => {
    assert.equal((0, saveGlob_1.matchesSaveGlob)("save:foo?.ts", "foo1.ts"), true);
    assert.equal((0, saveGlob_1.matchesSaveGlob)("save:foo?.ts", "foo12.ts"), false);
    assert.equal((0, saveGlob_1.matchesSaveGlob)("save:foo?.ts", "foo/1.ts"), false);
});
console.log("done.");
//# sourceMappingURL=janitorRules.test.js.map