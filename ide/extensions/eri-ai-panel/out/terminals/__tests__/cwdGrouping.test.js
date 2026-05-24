"use strict";
// Tests for cwdGrouping. Verifies that nested cwds resolve to the nearest
// ancestor group and new cwds spawn new groups named after the last
// path segment.
Object.defineProperty(exports, "__esModule", { value: true });
require("./vscodeStub");
const node_assert_1 = require("node:assert");
const cwdGrouping_1 = require("../cwdGrouping");
function makeGroup(id, name, cwd) {
    return {
        id,
        name,
        expanded: true,
        auto: true,
        cwd,
        createdAtMs: 0,
    };
}
function testNormalizeAndDescendant() {
    node_assert_1.strict.equal((0, cwdGrouping_1.normalizeCwd)("/foo/bar/"), "/foo/bar");
    node_assert_1.strict.equal((0, cwdGrouping_1.normalizeCwd)("/foo/bar//"), "/foo/bar");
    node_assert_1.strict.ok((0, cwdGrouping_1.isDescendantOf)("/foo/bar/baz", "/foo/bar"));
    node_assert_1.strict.ok((0, cwdGrouping_1.isDescendantOf)("/foo/bar", "/foo/bar"));
    node_assert_1.strict.ok(!(0, cwdGrouping_1.isDescendantOf)("/foo/bar", "/foo/bar/baz"));
    node_assert_1.strict.ok(!(0, cwdGrouping_1.isDescendantOf)("/other", "/foo"));
}
function testNearestGroupPicksDeepest() {
    const snapshot = {
        groups: [
            makeGroup("a", "monorepo", "/repo"),
            makeGroup("b", "web", "/repo/apps/web"),
            makeGroup("c", "api", "/repo/apps/api"),
        ],
        terminals: [],
    };
    const nearest = (0, cwdGrouping_1.findNearestGroup)(snapshot, "/repo/apps/web/src");
    node_assert_1.strict.ok(nearest);
    node_assert_1.strict.equal(nearest.id, "b");
}
function testNoMatchReturnsUndefined() {
    const snapshot = {
        groups: [makeGroup("a", "x", "/foo")],
        terminals: [],
    };
    node_assert_1.strict.equal((0, cwdGrouping_1.findNearestGroup)(snapshot, "/elsewhere"), undefined);
}
function testAutoGroupNameUsesLastSegment() {
    node_assert_1.strict.equal((0, cwdGrouping_1.autoGroupNameFromCwd)("/users/khai/projects/eri"), "eri");
    node_assert_1.strict.equal((0, cwdGrouping_1.autoGroupNameFromCwd)("/"), "shell");
    node_assert_1.strict.equal((0, cwdGrouping_1.autoGroupNameFromCwd)(""), "shell");
}
function testResolveCreatesGroupWhenMissing() {
    const empty = { groups: [], terminals: [] };
    const outcome = (0, cwdGrouping_1.resolveAutoGroup)(empty, "/repo/apps/web");
    node_assert_1.strict.equal(outcome.created, true);
    node_assert_1.strict.equal(outcome.snapshot.groups.length, 1);
    node_assert_1.strict.equal(outcome.snapshot.groups[0].name, "web");
}
function testResolveReusesExistingGroup() {
    const snapshot = {
        groups: [makeGroup("g1", "repo", "/repo")],
        terminals: [],
    };
    const outcome = (0, cwdGrouping_1.resolveAutoGroup)(snapshot, "/repo/apps/web");
    node_assert_1.strict.equal(outcome.created, false);
    node_assert_1.strict.equal(outcome.groupId, "g1");
    node_assert_1.strict.equal(outcome.snapshot.groups.length, 1);
}
function main() {
    testNormalizeAndDescendant();
    testNearestGroupPicksDeepest();
    testNoMatchReturnsUndefined();
    testAutoGroupNameUsesLastSegment();
    testResolveCreatesGroupWhenMissing();
    testResolveReusesExistingGroup();
    console.log("cwdGrouping tests: ok");
}
main();
//# sourceMappingURL=cwdGrouping.test.js.map