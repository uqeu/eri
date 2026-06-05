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

// --- full agent loop (runAgent) ---
function sseTurn(text, tool) {
  const lines = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":1}}}',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
    `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(text)}}}`,
  ];
  let stop = "end_turn";
  if (tool) {
    const [id, name, inp] = tool;
    lines.push(`data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":${JSON.stringify(id)},"name":${JSON.stringify(name)}}}`);
    lines.push(`data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":${JSON.stringify(JSON.stringify(inp))}}}`);
    stop = "tool_use";
  }
  lines.push(`data: {"type":"message_delta","delta":{"stop_reason":"${stop}"},"usage":{"output_tokens":2}}`);
  return lines.join("\n") + "\n";
}

const responses = [
  sseTurn("let me write it", ["t1", "write_file", { path: "a.txt" }]),
  sseTurn("all done"),
];
let calls = 0;
const transport = (_bodyJson) => responses[calls++];
const written = [];
const tools = {
  write_file: (inputJson) => {
    const p = JSON.parse(inputJson).path;
    written.push(p);
    return { content: `wrote ${p}`, isError: false };
  },
};
const specs = JSON.stringify([{ name: "write_file", description: "w", input_schema: { type: "object" } }]);
const result = m.runAgent(
  "claude-x", "[]",
  JSON.stringify([{ role: "user", content: "make a.txt" }]),
  transport, tools, specs, 8
);
assert.equal(result.stop, "done");
assert.equal(result.turns, 2);
assert.equal(result.finalText, "all done");
assert.deepEqual(written, ["a.txt"]);
const convo = JSON.parse(result.messages);
const toolResults = convo.flatMap((msg) =>
  Array.isArray(msg.content) ? msg.content.filter((b) => b && b.type === "tool_result") : []
);
assert.equal(toolResults[0].content, "wrote a.txt");
assert.equal(toolResults[0].is_error, false);

console.log(`node binding OK: all assertions passed; estimate=${n} -> after=${tokensAfter}; runAgent turns=${result.turns}`);
