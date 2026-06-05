"""End-to-end tests for the eri_agent_py Python bindings.

Run after building the module:
    cd crates/eri_agent_py
    maturin develop            # or: cargo build && cp target/debug/liberi_agent_py.dylib eri_agent_py.so
    python -m pytest tests/    # or: python tests/test_bindings.py
"""

import json

import eri_agent_py as e


def test_permission_model():
    assert e.permission_allows_shell("workspace-write") is True
    assert e.permission_allows_shell("bypass") is True
    assert e.permission_allows_shell("plan") is False
    assert e.permission_allows_shell("accept-edits") is False
    assert e.permission_allows_writes("plan") is False
    assert e.permission_allows_writes("accept-edits") is True


def test_styles():
    assert e.style_directive("builder") is None
    assert "REVIEWER" in e.style_directive("reviewer")
    assert "EXPLAINER" in e.style_directive("explainer")
    # vendor-neutral
    assert "claude" not in e.style_directive("concise").lower()


def test_token_estimate_and_compaction():
    msgs = json.dumps(
        [{"role": "user", "content": "x" * 80_000},
         {"role": "user", "content": "recent"}]
    )
    n = e.estimate_tokens(msgs)
    assert n > 10_000
    shaped, after = e.shape_context(msgs, 1_000)
    # Shaping never grows the context.
    assert after <= n
    # The shaped result is still valid JSON.
    json.loads(shaped)


def test_request_body():
    body = e.messages_body(
        "claude-x", 32_000, "[]", "[]",
        json.dumps([{"role": "user", "content": "hi"}]),
    )
    b = json.loads(body)
    assert b["model"] == "claude-x"
    assert b["max_tokens"] == 32_000
    assert b["stream"] is True
    assert b["messages"][0]["content"] == "hi"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("all binding tests passed")
