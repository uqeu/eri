# eri_agent_py — Python bindings for the eri-code Agent SDK core

PyO3 bindings over the [`eri_agent`](../eri_agent) Rust crate, exposing the
transport-agnostic building blocks of the eri agent loop to Python:

| Function | What it does |
|---|---|
| `estimate_tokens(messages_json)` | token footprint of a messages array |
| `shape_context(messages_json, target)` | layered context compaction → `(shaped_json, tokens_after)` |
| `permission_allows_writes(mode)` / `permission_allows_shell(mode)` | the permission capability ladder |
| `style_directive(style)` | the output-style directive (`reviewer` / `explainer` / `concise`) |
| `messages_body(model, max_tokens, system_json, tools_json, messages_json)` | build a streaming request body |
| `run_agent(model, system_json, messages_json, transport, tools, tool_specs_json, max_turns)` | **run a full agent loop** driven by your callbacks |

Interop is over JSON strings (the Anthropic Messages wire shape) to keep the
surface tiny and stable.

### Running an agent from Python

`run_agent` is the whole loop (shape context → request → your transport → parse →
dispatch your tools → repeat). You own the I/O:

```python
import json, eri_agent_py as e

def transport(body_json):           # you make the model call, return the SSE text
    return http_post("/v1/messages", body_json)

def write_file(input_json):         # a tool you implement
    p = json.loads(input_json)["path"]
    open(p, "w").write("...")
    return {"content": f"wrote {p}", "is_error": False}

specs = json.dumps([{ "name": "write_file", "description": "...", "input_schema": {"type": "object"} }])
result = e.run_agent(
    "claude-sonnet-4-6", "[]",
    json.dumps([{"role": "user", "content": "make a.txt"}]),
    transport, {"write_file": write_file}, specs, max_turns=24,
)
print(result["final_text"], result["turns"], result["tokens_out"])
```

## Build

This crate is **excluded from the eri Cargo workspace** because a Python
extension `cdylib` needs maturin's `-undefined dynamic_lookup` linker flag,
which a plain `cargo build --workspace` from the repo root doesn't supply. Build
it from this directory:

```bash
cd crates/eri_agent_py

# Option A: maturin (recommended — installs into the active venv)
pip install maturin
maturin develop
python -m pytest tests/          # or: python tests/test_bindings.py

# Option B: plain cargo (the local .cargo/config.toml supplies the linker flag)
cargo build
cp target/debug/liberi_agent_py.dylib eri_agent_py.so   # .so on macOS too for import
python tests/test_bindings.py
```

Built with `abi3-py38`, so one wheel works across CPython ≥ 3.8.

## Status

The Rust binding surface + conversion logic are tested (`cargo test` rlib unit
test) and the module is verified end-to-end against CPython 3.13
(`tests/test_bindings.py`, all green) -- including `run_agent` driving a complete
agent loop (tool dispatch + termination) against a fake transport.
