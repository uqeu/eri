# eri (Python SDK)

```bash
pip install eri
```

```python
from eri import Eri

eri = Eri(api_key="eri_sk_...")  # or set ERI_API_KEY

# One-shot
answer = eri.ask("what is tokio's runtime model?")
print(answer)

# Streaming
for event in eri.stream(intent="plan", prompt="add Stripe checkout"):
    if event["kind"] == "token":
        print(event["text"], end="", flush=True)

# Memory
eri.memory.remember("I prefer pnpm over npm.")
obs = eri.memory.recall("package manager")
```

## Async

```python
import asyncio
from eri import Eri

async def main():
    eri = Eri()
    answer = await eri.aask("what is tokio?")
    print(answer)

asyncio.run(main())
```

## License

MIT
