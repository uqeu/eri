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

Interop is over JSON strings (the Anthropic Messages wire shape).

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

Verified end-to-end against Node v22 (`tests/test_bindings.mjs`, all green). The
loop driver (`eri_agent::driver::run`) is not yet bound — it needs a
JS-callback `Transport` (async across the FFI boundary), the next step.
