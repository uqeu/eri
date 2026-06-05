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


def _sse_turn(text, tool=None):
    """Build a canned Anthropic SSE response for one turn."""
    lines = [
        'data: {"type":"message_start","message":{"usage":{"input_tokens":1}}}',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":%s}}'
        % json.dumps(text),
    ]
    if tool:
        tid, name, inp = tool
        lines.append(
            'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":%s,"name":%s}}'
            % (json.dumps(tid), json.dumps(name))
        )
        lines.append(
            'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":%s}}'
            % json.dumps(json.dumps(inp))
        )
        stop = "tool_use"
    else:
        stop = "end_turn"
    lines.append(
        'data: {"type":"message_delta","delta":{"stop_reason":"%s"},"usage":{"output_tokens":2}}'
        % stop
    )
    return "\n".join(lines) + "\n"


def test_run_agent_full_loop():
    # Turn 1: model calls write_file. Turn 2: model ends.
    responses = [
        _sse_turn("let me write it", ("t1", "write_file", {"path": "a.txt"})),
        _sse_turn("all done"),
    ]
    calls = {"n": 0, "bodies": []}

    def transport(body_json):
        calls["bodies"].append(json.loads(body_json))
        r = responses[calls["n"]]
        calls["n"] += 1
        return r

    written = []

    def write_file(input_json):
        path = json.loads(input_json).get("path", "?")
        written.append(path)
        return {"content": f"wrote {path}", "is_error": False}

    specs = json.dumps([{"name": "write_file", "description": "w", "input_schema": {"type": "object"}}])
    result = e.run_agent(
        "claude-x",
        "[]",
        json.dumps([{"role": "user", "content": "make a.txt"}]),
        transport,
        {"write_file": write_file},
        specs,
        max_turns=8,
    )

    assert result["stop"] == "done"
    assert result["turns"] == 2
    assert result["final_text"] == "all done"
    assert calls["n"] == 2
    assert written == ["a.txt"]
    # The conversation has the tool_result the agent saw.
    msgs = json.loads(result["messages"])
    tool_results = [
        b for msg in msgs if isinstance(msg["content"], list)
        for b in msg["content"] if isinstance(b, dict) and b.get("type") == "tool_result"
    ]
    assert tool_results[0]["content"] == "wrote a.txt"
    assert tool_results[0]["is_error"] is False


def test_run_agent_unknown_tool_is_error_not_crash():
    responses = [
        _sse_turn("calling", ("t1", "nope", {})),
        _sse_turn("ok"),
    ]
    n = {"i": 0}

    def transport(_body):
        r = responses[n["i"]]
        n["i"] += 1
        return r

    result = e.run_agent("m", "[]", "[]", transport, {}, "[]", max_turns=8)
    assert result["stop"] == "done"
    msgs = json.loads(result["messages"])
    tr = [
        b for msg in msgs if isinstance(msg["content"], list)
        for b in msg["content"] if isinstance(b, dict) and b.get("type") == "tool_result"
    ][0]
    assert tr["is_error"] is True
    assert "unknown tool" in tr["content"]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("all binding tests passed")
