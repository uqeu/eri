# @eri/sdk

TypeScript SDK for **eri** — the voice-first agentic IDE that also lives in your terminal.

```bash
npm i @eri/sdk
```

```ts
import { Eri } from "@eri/sdk";

const eri = new Eri({ apiKey: process.env.ERI_API_KEY });

// One-shot.
const answer = await eri.ask("what is tokio's runtime model?");
console.log(answer);

// Streaming.
for await (const event of eri.stream({ intent: "plan", prompt: "add Stripe checkout" })) {
  if (event.kind === "token") process.stdout.write(event.text);
}

// Personal memory.
await eri.memory.remember("I prefer pnpm over npm.");
const obs = await eri.memory.recall("package manager");
```

## Intents

| Method | Persona | Notes |
|---|---|---|
| `ask` | `eri` | One-off Q&A, brain-routed |
| `plan` | `architect` | Markdown plan |
| `ship` | `shipper` | Unified-diff change |
| `test` | `tester` | Generate tests |
| `refactor` | `architect` | Refactor proposal |
| `explain` | `eri` | Plain-language explanation |
| `sketch` | `mercury` | Mercury one-shot draft |

## Configuration

| Option | Default | Env |
|---|---|---|
| `apiKey` | required | `ERI_API_KEY` |
| `baseUrl` | `https://tryeri.ca` | `ERI_BASE_URL` |
| `timeoutMs` | `120000` | — |
| `fetch` | global | — |

## License

MIT
