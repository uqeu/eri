"use strict";
// Tests for layout (de)serialization round-trip.
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const layouts_1 = require("../layouts");
function testRoundTrip() {
    const original = {
        name: "Frontend dev",
        description: "for testing",
        groups: [
            {
                name: "Web",
                icon: "rocket",
                terminals: [
                    { name: "vite", cwd: "apps/web", command: "npm run dev" },
                    { name: "stories", cwd: "apps/web", command: "npm run storybook" },
                ],
            },
            {
                name: "Tests",
                terminals: [
                    { name: "vitest", cwd: "apps/web", command: "npx vitest --watch" },
                ],
            },
        ],
    };
    const cloned = (0, layouts_1.cloneLayout)(original);
    node_assert_1.strict.ok(cloned);
    node_assert_1.strict.equal(cloned.name, original.name);
    node_assert_1.strict.equal(cloned.groups.length, original.groups.length);
    node_assert_1.strict.equal(cloned.groups[0].terminals.length, 2);
    node_assert_1.strict.equal(cloned.groups[0].terminals[0].command, "npm run dev");
    node_assert_1.strict.equal(cloned.groups[0].icon, "rocket");
}
function testMissingFieldsDefaultSanely() {
    const partial = {
        name: "minimal",
        groups: [
            { name: "g", terminals: [{ name: "t" }] }, // no cwd, no command
        ],
    };
    const parsed = (0, layouts_1.parseLayout)(partial);
    node_assert_1.strict.ok(parsed);
    node_assert_1.strict.equal(parsed.groups[0].terminals[0].cwd, "");
    node_assert_1.strict.equal(parsed.groups[0].terminals[0].command, undefined);
}
function testInvalidReturnsNull() {
    node_assert_1.strict.equal((0, layouts_1.parseLayout)(null), null);
    node_assert_1.strict.equal((0, layouts_1.parseLayout)({}), null);
    node_assert_1.strict.equal((0, layouts_1.parseLayout)({ groups: [] }), null);
    node_assert_1.strict.equal((0, layouts_1.parseLayout)({ name: "" }), null);
}
function testSerializeEndsWithNewline() {
    const layout = {
        name: "test",
        groups: [],
    };
    const text = (0, layouts_1.serializeLayout)(layout);
    node_assert_1.strict.ok(text.endsWith("\n"));
    // Round-trippable through JSON.
    node_assert_1.strict.deepEqual(JSON.parse(text).name, "test");
}
function testSafeFileNameStrips() {
    node_assert_1.strict.equal((0, layouts_1.safeFileName)("Frontend Dev"), "frontend-dev");
    node_assert_1.strict.equal((0, layouts_1.safeFileName)("weird!@#chars"), "weirdchars");
    node_assert_1.strict.equal((0, layouts_1.safeFileName)(""), `layout-${(0, layouts_1.safeFileName)("").split("-")[1] ?? ""}`.replace(/-$/, "") || (0, layouts_1.safeFileName)(""));
}
function testDropsMalformedGroups() {
    const layout = (0, layouts_1.parseLayout)({
        name: "x",
        groups: [
            { name: "good", terminals: [{ name: "t1" }] },
            { name: "", terminals: [] }, // dropped — empty name
            "garbage",
            { terminals: [] }, // dropped — no name
        ],
    });
    node_assert_1.strict.ok(layout);
    node_assert_1.strict.equal(layout.groups.length, 1);
    node_assert_1.strict.equal(layout.groups[0].name, "good");
}
function main() {
    testRoundTrip();
    testMissingFieldsDefaultSanely();
    testInvalidReturnsNull();
    testSerializeEndsWithNewline();
    testSafeFileNameStrips();
    testDropsMalformedGroups();
    console.log("layouts tests: ok");
}
main();
//# sourceMappingURL=layouts.test.js.map