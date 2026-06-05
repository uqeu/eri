// End-to-end tests for the eri_agent_node bindings.
//
// Build first:
//   cd crates/eri_agent_node
//   cargo build && cp target/debug/liberi_agent_node.dylib eri_agent_node.node
//   node tests/test_bindings.mjs
// (with @napi-rs/cli: `napi build` produces the .node + a typed index.js.)

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const m = require(join(here, "..", "eri_agent_node.node"));

// permission model
assert.equal(m.permissionAllowsShell("workspace-write"), true);
assert.equal(m.permissionAllowsShell("bypass"), true);
assert.equal(m.permissionAllowsShell("plan"), false);
assert.equal(m.permissionAllowsWrites("plan"), false);
assert.equal(m.permissionAllowsWrites("accept-edits"), true);

// styles
assert.equal(m.styleDirective("builder"), null);
assert.ok(m.styleDirective("reviewer").includes("REVIEWER"));
assert.ok(!m.styleDirective("concise").toLowerCase().includes("claude"));

// token estimate + compaction
const msgs = JSON.stringify([
  { role: "user", content: "x".repeat(80000) },
  { role: "user", content: "recent" },
]);
const n = m.estimateTokens(msgs);
assert.ok(n > 10000, `estimate too small: ${n}`);
const { shaped, tokensAfter } = m.shapeContext(msgs, 1000);
assert.ok(tokensAfter <= n);
JSON.parse(shaped); // still valid JSON

// request body
const body = JSON.parse(
  m.messagesBody("claude-x", 32000, "[]", "[]", JSON.stringify([{ role: "user", content: "hi" }]))
);
assert.equal(body.model, "claude-x");
assert.equal(body.stream, true);
assert.equal(body.messages[0].content, "hi");

console.log(`node binding OK: all assertions passed; estimate=${n} -> after=${tokensAfter}`);
