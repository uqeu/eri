"""Python SDK for eri — the voice-first agentic IDE.

Mirrors `@eri/sdk` (TypeScript) ergonomics. Exposes a single ``Eri``
class with ``ask``/``plan``/``ship``/``test``/``refactor``/``explain``
/``sketch`` plus ``memory.recall``/``remember``/``forget`` and
``usage()``.

Example::

    from eri import Eri

    eri = Eri(api_key="eri_sk_...")
    answer = eri.ask("what is tokio's runtime model?")
    print(answer)

    # Streaming
    for event in eri.stream(intent="plan", prompt="add Stripe checkout"):
        if event["kind"] == "token":
            print(event["text"], end="", flush=True)

Async variants live under ``eri.async_`` if you want awaitable calls.
"""

from .client import (
    AgentEvent,
    Eri,
    EriError,
    Intent,
    Observation,
    UsageSummary,
)

__all__ = [
    "AgentEvent",
    "Eri",
    "EriError",
    "Intent",
    "Observation",
    "UsageSummary",
]

__version__ = "0.1.0"
