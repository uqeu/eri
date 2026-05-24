// Tests for cwdGrouping. Verifies that nested cwds resolve to the nearest
// ancestor group and new cwds spawn new groups named after the last
// path segment.

import "./vscodeStub";
import { strict as assert } from "node:assert";
import {
  autoGroupNameFromCwd,
  findNearestGroup,
  isDescendantOf,
  normalizeCwd,
  resolveAutoGroup,
} from "../cwdGrouping";
import { GroupRecord, StateSnapshot } from "../state";

function makeGroup(id: string, name: string, cwd?: string): GroupRecord {
  return {
    id,
    name,
    expanded: true,
    auto: true,
    cwd,
    createdAtMs: 0,
  };
}

function testNormalizeAndDescendant(): void {
  assert.equal(normalizeCwd("/foo/bar/"), "/foo/bar");
  assert.equal(normalizeCwd("/foo/bar//"), "/foo/bar");
  assert.ok(isDescendantOf("/foo/bar/baz", "/foo/bar"));
  assert.ok(isDescendantOf("/foo/bar", "/foo/bar"));
  assert.ok(!isDescendantOf("/foo/bar", "/foo/bar/baz"));
  assert.ok(!isDescendantOf("/other", "/foo"));
}

function testNearestGroupPicksDeepest(): void {
  const snapshot: StateSnapshot = {
    groups: [
      makeGroup("a", "monorepo", "/repo"),
      makeGroup("b", "web", "/repo/apps/web"),
      makeGroup("c", "api", "/repo/apps/api"),
    ],
    terminals: [],
  };
  const nearest = findNearestGroup(snapshot, "/repo/apps/web/src");
  assert.ok(nearest);
  assert.equal(nearest.id, "b");
}

function testNoMatchReturnsUndefined(): void {
  const snapshot: StateSnapshot = {
    groups: [makeGroup("a", "x", "/foo")],
    terminals: [],
  };
  assert.equal(findNearestGroup(snapshot, "/elsewhere"), undefined);
}

function testAutoGroupNameUsesLastSegment(): void {
  assert.equal(autoGroupNameFromCwd("/users/khai/projects/eri"), "eri");
  assert.equal(autoGroupNameFromCwd("/"), "shell");
  assert.equal(autoGroupNameFromCwd(""), "shell");
}

function testResolveCreatesGroupWhenMissing(): void {
  const empty: StateSnapshot = { groups: [], terminals: [] };
  const outcome = resolveAutoGroup(empty, "/repo/apps/web");
  assert.equal(outcome.created, true);
  assert.equal(outcome.snapshot.groups.length, 1);
  assert.equal(outcome.snapshot.groups[0].name, "web");
}

function testResolveReusesExistingGroup(): void {
  const snapshot: StateSnapshot = {
    groups: [makeGroup("g1", "repo", "/repo")],
    terminals: [],
  };
  const outcome = resolveAutoGroup(snapshot, "/repo/apps/web");
  assert.equal(outcome.created, false);
  assert.equal(outcome.groupId, "g1");
  assert.equal(outcome.snapshot.groups.length, 1);
}

function main(): void {
  testNormalizeAndDescendant();
  testNearestGroupPicksDeepest();
  testNoMatchReturnsUndefined();
  testAutoGroupNameUsesLastSegment();
  testResolveCreatesGroupWhenMissing();
  testResolveReusesExistingGroup();
  console.log("cwdGrouping tests: ok");
}

main();
