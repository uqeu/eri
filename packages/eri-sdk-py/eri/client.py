"""Synchronous + async eri SDK client."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import (
    Any,
    AsyncIterator,
    Iterator,
    Literal,
    Optional,
    TypedDict,
    cast,
)

import httpx

DEFAULT_BASE_URL = "https://tryeri.ca"
SDK_VERSION = "0.1.0"

Intent = Literal[
    "ask",
    "plan",
    "ship",
    "test",
    "refactor",
    "explain",
    "sketch",
]


class AgentEvent(TypedDict, total=False):
    """One streamed agent event."""

    kind: Literal["token", "tool_call", "done", "error"]
    text: str
    message: str
    tokensIn: int
    tokensOut: int
    routedTo: str


class Observation(TypedDict, total=False):
    id: str
    kind: str
    body: str
    tsMs: int


class UsageSummary(TypedDict, total=False):
    tier: str
    tokens: dict
    period: dict


class EriError(Exception):
    """Raised on any non-2xx response from the eri API."""

    def __init__(
        self,
        message: str,
        status: int,
        code: Optional[str] = None,
        payload: Any = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.payload = payload


@dataclass
class _Memory:
    eri: "Eri"

    def recall(self, query: str, limit: int = 20) -> list[Observation]:
        data = self.eri._request_json(
            "POST",
            "/api/v1/memory/recall",
            json={"query": query, "limit": limit},
        )
        return cast(list[Observation], data.get("results", []))

    def remember(self, text: str) -> dict[str, str]:
        return self.eri._request_json(
            "POST",
            "/api/v1/memory/remember",
            json={"text": text},
        )

    def forget(self, target: str) -> dict[str, int]:
        return self.eri._request_json(
            "POST",
            "/api/v1/memory/forget",
            json={"target": target},
        )


@dataclass
class _AsyncMemory:
    eri: "Eri"

    async def recall(self, query: str, limit: int = 20) -> list[Observation]:
        data = await self.eri._arequest_json(
            "POST",
            "/api/v1/memory/recall",
            json={"query": query, "limit": limit},
        )
        return cast(list[Observation], data.get("results", []))

    async def remember(self, text: str) -> dict[str, str]:
        return await self.eri._arequest_json(
            "POST",
            "/api/v1/memory/remember",
            json={"text": text},
        )

    async def forget(self, target: str) -> dict[str, int]:
        return await self.eri._arequest_json(
            "POST",
            "/api/v1/memory/forget",
            json={"target": target},
        )


@dataclass
class Eri:
    """eri API client.

    Pass ``api_key`` explicitly or set ``ERI_API_KEY`` in the env.
    """

    api_key: Optional[str] = None
    base_url: Optional[str] = None
    timeout_seconds: float = 120.0
    user_agent: str = field(default=f"eri-py/{SDK_VERSION}")

    def __post_init__(self) -> None:
        key = self.api_key or os.environ.get("ERI_API_KEY")
        if not key:
            raise EriError(
                "missing api_key — pass api_key= or set ERI_API_KEY",
                400,
                "missing_api_key",
            )
        self.api_key = key
        self.base_url = (
            self.base_url
            or os.environ.get("ERI_BASE_URL")
            or DEFAULT_BASE_URL
        ).rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": self.user_agent,
        }
        self.memory = _Memory(self)
        self.async_memory = _AsyncMemory(self)

    # -- intent helpers (sync) --
    def ask(self, prompt: str, **kw: Any) -> str:
        return self._buffer({"intent": "ask", "prompt": prompt, **kw})

    def plan(self, prompt: str, **kw: Any) -> str:
        return self._buffer({"intent": "plan", "prompt": prompt, **kw})

    def ship(self, prompt: str, **kw: Any) -> str:
        return self._buffer({"intent": "ship", "prompt": prompt, **kw})

    def test(self, scope: str = "", **kw: Any) -> str:
        body = {
            "intent": "test",
            "prompt": scope or "Add tests where missing.",
            **kw,
        }
        if scope:
            body["targets"] = [scope]
        return self._buffer(body)

    def refactor(self, scope: str = "", **kw: Any) -> str:
        body = {
            "intent": "refactor",
            "prompt": scope or "Suggest a refactor.",
            **kw,
        }
        if scope:
            body["targets"] = [scope]
        return self._buffer(body)

    def explain(self, target: str, **kw: Any) -> str:
        body = {
            "intent": "explain",
            "prompt": f"Explain {target}.",
            "targets": [target],
            **kw,
        }
        return self._buffer(body)

    def sketch(self, prompt: str, **kw: Any) -> str:
        return self._buffer({"intent": "sketch", "prompt": prompt, **kw})

    def stream(self, **kw: Any) -> Iterator[AgentEvent]:
        """Yield events as they arrive. Caller drives the iterator."""
        if "intent" not in kw or "prompt" not in kw:
            raise ValueError("stream requires intent= and prompt=")
        with httpx.stream(
            "POST",
            f"{self.base_url}/api/v1/agent/run",
            headers={**self._headers, "Accept": "text/event-stream"},
            json={k: v for k, v in kw.items() if v is not None},
            timeout=self.timeout_seconds,
        ) as response:
            _raise_for_status(response)
            buffer = ""
            for chunk in response.iter_text():
                buffer += chunk
                while "\n\n" in buffer:
                    block, buffer = buffer.split("\n\n", 1)
                    for line in block.splitlines():
                        if not line.startswith("data:"):
                            continue
                        payload = line[len("data:") :].strip()
                        if not payload or payload == "[DONE]":
                            continue
                        try:
                            yield cast(AgentEvent, json.loads(payload))
                        except json.JSONDecodeError:
                            continue

    def usage(self) -> UsageSummary:
        return cast(UsageSummary, self._request_json("GET", "/api/v1/usage"))

    # -- internal sync transport --
    def _buffer(self, body: dict[str, Any]) -> str:
        out: list[str] = []
        for event in self.stream(**body):
            kind = event.get("kind")
            if kind == "token":
                out.append(event.get("text", ""))
            elif kind == "error":
                raise EriError(
                    event.get("message", "agent error"),
                    500,
                    "agent_error",
                )
        return "".join(out)

    def _request_json(
        self,
        method: str,
        path: str,
        json: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        with httpx.Client(timeout=self.timeout_seconds) as client:
            response = client.request(
                method,
                f"{self.base_url}{path}",
                headers=self._headers,
                json=json,
            )
            _raise_for_status(response)
            return cast(dict[str, Any], response.json())

    # -- async transport --
    async def astream(self, **kw: Any) -> AsyncIterator[AgentEvent]:
        if "intent" not in kw or "prompt" not in kw:
            raise ValueError("astream requires intent= and prompt=")
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/v1/agent/run",
                headers={**self._headers, "Accept": "text/event-stream"},
                json={k: v for k, v in kw.items() if v is not None},
            ) as response:
                _raise_for_status(response)
                buffer = ""
                async for chunk in response.aiter_text():
                    buffer += chunk
                    while "\n\n" in buffer:
                        block, buffer = buffer.split("\n\n", 1)
                        for line in block.splitlines():
                            if not line.startswith("data:"):
                                continue
                            payload = line[len("data:") :].strip()
                            if not payload or payload == "[DONE]":
                                continue
                            try:
                                yield cast(AgentEvent, json.loads(payload))
                            except json.JSONDecodeError:
                                continue

    async def aask(self, prompt: str, **kw: Any) -> str:
        out: list[str] = []
        async for event in self.astream(intent="ask", prompt=prompt, **kw):
            if event.get("kind") == "token":
                out.append(event.get("text", ""))
            elif event.get("kind") == "error":
                raise EriError(
                    event.get("message", "agent error"),
                    500,
                    "agent_error",
                )
        return "".join(out)

    async def _arequest_json(
        self,
        method: str,
        path: str,
        json: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.request(
                method,
                f"{self.base_url}{path}",
                headers=self._headers,
                json=json,
            )
            _raise_for_status(response)
            return cast(dict[str, Any], response.json())


def _raise_for_status(response: httpx.Response) -> None:
    if response.is_success:
        return
    code: Optional[str] = None
    payload: Any = None
    try:
        payload = response.json()
        if isinstance(payload, dict) and isinstance(payload.get("error"), str):
            code = payload["error"]
    except Exception:
        pass
    raise EriError(
        f"HTTP {response.status_code}: {code or response.reason_phrase}",
        response.status_code,
        code,
        payload,
    )
