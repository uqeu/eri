"use strict";
// Schema completeness tests — sanity-check that we ship at least 110
// preference fields across all 14 categories.
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("node:assert/strict");
const preferencesSchema_1 = require("../preferencesSchema");
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
console.log("preferencesSchema.test.ts");
run("ships at least 110 fields", () => {
    assert.ok((0, preferencesSchema_1.totalFieldCount)() >= 110, `expected ≥110 fields per plan, got ${(0, preferencesSchema_1.totalFieldCount)()}`);
});
run("covers all 14 categories", () => {
    const map = (0, preferencesSchema_1.fieldsByCategory)();
    const categories = Object.keys(map);
    const required = [
        "stack",
        "testing",
        "codeStyle",
        "naming",
        "fileOrg",
        "comments",
        "git",
        "docs",
        "a11y",
        "performance",
        "security",
        "i18n",
        "workflow",
        "models",
    ];
    for (const c of required) {
        assert.ok(categories.includes(c), `missing category ${c}`);
        assert.ok(map[c].length > 0, `category ${c} is empty`);
    }
});
run("no duplicate paths", () => {
    const seen = new Set();
    for (const f of preferencesSchema_1.PREFERENCE_FIELDS) {
        assert.ok(!seen.has(f.path), `duplicate path ${f.path}`);
        seen.add(f.path);
    }
});
run("every field carries a non-empty label", () => {
    for (const f of preferencesSchema_1.PREFERENCE_FIELDS) {
        assert.ok(f.label.length > 0, `empty label for ${f.path}`);
    }
});
console.log("done.");
//# sourceMappingURL=schema.test.js.map