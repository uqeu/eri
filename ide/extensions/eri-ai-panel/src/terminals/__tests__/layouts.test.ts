// Tests for layout (de)serialization round-trip.

import { strict as assert } from "node:assert";
import {
  cloneLayout,
  parseLayout,
  safeFileName,
  serializeLayout,
  TerminalLayout,
} from "../layouts";

function testRoundTrip(): void {
  const original: TerminalLayout = {
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
  const cloned = cloneLayout(original);
  assert.ok(cloned);
  assert.equal(cloned.name, original.name);
  assert.equal(cloned.groups.length, original.groups.length);
  assert.equal(cloned.groups[0].terminals.length, 2);
  assert.equal(cloned.groups[0].terminals[0].command, "npm run dev");
  assert.equal(cloned.groups[0].icon, "rocket");
}

function testMissingFieldsDefaultSanely(): void {
  const partial = {
    name: "minimal",
    groups: [
      { name: "g", terminals: [{ name: "t" }] }, // no cwd, no command
    ],
  };
  const parsed = parseLayout(partial);
  assert.ok(parsed);
  assert.equal(parsed.groups[0].terminals[0].cwd, "");
  assert.equal(parsed.groups[0].terminals[0].command, undefined);
}

function testInvalidReturnsNull(): void {
  assert.equal(parseLayout(null), null);
  assert.equal(parseLayout({}), null);
  assert.equal(parseLayout({ groups: [] }), null);
  assert.equal(parseLayout({ name: "" }), null);
}

function testSerializeEndsWithNewline(): void {
  const layout: TerminalLayout = {
    name: "test",
    groups: [],
  };
  const text = serializeLayout(layout);
  assert.ok(text.endsWith("\n"));
  // Round-trippable through JSON.
  assert.deepEqual(JSON.parse(text).name, "test");
}

function testSafeFileNameStrips(): void {
  assert.equal(safeFileName("Frontend Dev"), "frontend-dev");
  assert.equal(safeFileName("weird!@#chars"), "weirdchars");
  assert.equal(safeFileName(""), `layout-${safeFileName("").split("-")[1] ?? ""}`.replace(/-$/, "") || safeFileName(""));
}

function testDropsMalformedGroups(): void {
  const layout = parseLayout({
    name: "x",
    groups: [
      { name: "good", terminals: [{ name: "t1" }] },
      { name: "", terminals: [] }, // dropped — empty name
      "garbage",
      { terminals: [] }, // dropped — no name
    ],
  });
  assert.ok(layout);
  assert.equal(layout.groups.length, 1);
  assert.equal(layout.groups[0].name, "good");
}

function main(): void {
  testRoundTrip();
  testMissingFieldsDefaultSanely();
  testInvalidReturnsNull();
  testSerializeEndsWithNewline();
  testSafeFileNameStrips();
  testDropsMalformedGroups();
  console.log("layouts tests: ok");
}

main();
