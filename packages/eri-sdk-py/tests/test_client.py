"""Tests for the eri Python SDK."""

from __future__ import annotations

import os
import pytest
import httpx

from eri import Eri, EriError


SSE_OK = "data: {\"kind\":\"token\",\"text\":\"Hello, \"}\n\ndata: {\"kind\":\"token\",\"text\":\"world!\"}\n\ndata: {\"kind\":\"done\",\"tokensIn\":4,\"tokensOut\":3}\n\ndata: [DONE]\n\n"


def _mock(method: str, url: str, content: str = "", status: int = 200, headers: dict | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, content=content, headers=headers or {"content-type": "text/event-stream"})
    return httpx.MockTransport(handler)


def test_raises_when_api_key_missing(monkeypatch):
    monkeypatch.delenv("ERI_API_KEY", raising=False)
    with pytest.raises(EriError) as exc:
        Eri()
    assert exc.value.status == 400
    assert "missing api_key" in str(exc.value)


def test_buffers_stream_into_string(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "stream",
        lambda *args, **kwargs: _StreamCtx(SSE_OK),
    )
    eri = Eri(api_key="eri_sk_test")
    result = eri.ask("hi")
    assert result == "Hello, world!"


def test_stream_yields_events(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "stream",
        lambda *args, **kwargs: _StreamCtx(SSE_OK),
    )
    eri = Eri(api_key="eri_sk_test")
    events = list(eri.stream(intent="ask", prompt="hi"))
    kinds = [e["kind"] for e in events]
    assert kinds == ["token", "token", "done"]


def test_error_event_raises_eri_error(monkeypatch):
    err_stream = "data: {\"kind\":\"error\",\"message\":\"model unavailable\"}\n\ndata: [DONE]\n\n"
    monkeypatch.setattr(
        httpx,
        "stream",
        lambda *args, **kwargs: _StreamCtx(err_stream),
    )
    eri = Eri(api_key="eri_sk_test")
    with pytest.raises(EriError, match="model unavailable"):
        eri.ask("hi")


def test_base_url_trims_trailing_slashes():
    eri = Eri(api_key="eri_sk_test", base_url="https://tryeri.ca//")
    assert eri.base_url == "https://tryeri.ca"


def test_env_var_provides_api_key(monkeypatch):
    monkeypatch.setenv("ERI_API_KEY", "eri_sk_env")
    eri = Eri()
    assert eri.api_key == "eri_sk_env"


# ---- helpers ----------------------------------------------------------

class _StreamCtx:
    """Minimal context-manager replacement for httpx.stream that yields a known SSE body."""

    def __init__(self, body: str) -> None:
        self._body = body

    def __enter__(self) -> "_StreamResp":
        return _StreamResp(self._body)

    def __exit__(self, *args) -> None:
        return None


class _StreamResp:
    def __init__(self, body: str) -> None:
        self.status_code = 200
        self.is_success = True
        self._body = body
        self.reason_phrase = "OK"

    def iter_text(self):
        # one chunk per "data:" block for realism
        for line in self._body.split("\n\n"):
            yield line + ("\n\n" if line else "")

    def json(self):
        raise ValueError("not JSON")
