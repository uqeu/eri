# @eri/agent — Node / TypeScript bindings for the eri-code Agent SDK core

[napi-rs](https://napi.rs) bindings over the [`eri_agent`](../eri_agent) Rust
crate. napi auto-converts the snake_case Rust names to camelCase in JS.

| JS function | What it does |
|---|---|
| `estimateTokens(messagesJson)` | token footprint of a messages array |
| `shapeContext(messagesJson, target)` | layered compaction → `{ shaped, tokensAfter }` |
| `permissionAllowsWrites(mode)` / `permissionAllowsShell(mode)` | the permission ladder |
| `styleDirective(style)` | output-style directive (`reviewer`/`explainer`/`concise`) or `null` |
| `messagesBody(model, maxTokens, systemJson, toolsJson, messagesJson)` | build a request body |
| `runAgent(model, systemJson, messagesJson, transport, tools, toolSpecsJson, maxTurns)` | **run a full agent loop** with your callbacks |

Interop is over JSON strings (the Anthropic Messages wire shape).

### Running an agent from Node

```js
const m = require("./eri_agent_node.node");
const transport = (bodyJson) => httpPost("/v1/messages", bodyJson); // returns SSE text
const tools = {
  write_file: (inputJson) => {
    const p = JSON.parse(inputJson).path;
    fs.writeFileSync(p, "...");
    return { content: `wrote ${p}`, isError: false };
  },
};
const specs = JSON.stringify([{ name: "write_file", description: "...", input_schema: { type: "object" } }]);
const r = m.runAgent("claude-sonnet-4-6", "[]",
  JSON.stringify([{ role: "user", content: "make a.txt" }]),
  transport, tools, specs, 24);
console.log(r.finalText, r.turns, r.tokensOut);
```

## Build

This crate is **excluded from the eri Cargo workspace** (a Node native addon
`cdylib` needs the `-undefined dynamic_lookup` linker flag). Build from this dir:

```bash
cd crates/eri_agent_node

# Option A: @napi-rs/cli (recommended — emits the .node + index.js + index.d.ts)
npm install
npm run build
npm test

# Option B: plain cargo (the local .cargo/config.toml supplies the linker flag)
cargo build
cp target/debug/liberi_agent_node.dylib eri_agent_node.node
node tests/test_bindings.mjs
```

## Status

Verified end-to-end against Node v22 (`tests/test_bindings.mjs`, all green) --
including `runAgent` driving a complete agent loop (tool dispatch + termination)
against a fake transport.

### Release artifact (verified)

`npm run build` emits the native addon + `index.js` + **`index.d.ts`
TypeScript types**; `npm pack` produces a lean ~290 KB tarball
(`index.js` / `index.d.ts` / `*.node` / `README.md` only). The package entry
(`require("@eri/agent")`) is verified working. Publishing (`npm publish`) is a
deliberate manual step.
