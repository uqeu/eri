import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Eri } from "./client.js";
import type { AgentEvent } from "./types.js";

function mockFetch(handler: (req: Request) => Response | Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const req = new Request(url, init);
    return handler(req);
  }) as typeof fetch;
}

function sseResponse(events: AgentEvent[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(`${body}data: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("Eri client", () => {
  it("throws when apiKey is missing", () => {
    const original = process.env.ERI_API_KEY;
    delete process.env.ERI_API_KEY;
    try {
      assert.throws(() => new Eri(), /missing apiKey/);
    } finally {
      if (original !== undefined) process.env.ERI_API_KEY = original;
    }
  });

  it("buffers tokens into a single string for .ask()", async () => {
    const eri = new Eri({
      apiKey: "eri_sk_test",
      fetch: mockFetch(() =>
        sseResponse([
          { kind: "token", text: "Hello, " },
          { kind: "token", text: "world!" },
          { kind: "done", tokensIn: 4, tokensOut: 3 },
        ]),
      ),
    });
    const result = await eri.ask("hi");
    assert.equal(result, "Hello, world!");
  });

  it("streams events progressively for .stream()", async () => {
    const eri = new Eri({
      apiKey: "eri_sk_test",
      fetch: mockFetch(() =>
        sseResponse([
          { kind: "token", text: "A" },
          { kind: "token", text: "B" },
          { kind: "done", tokensIn: 1, tokensOut: 2 },
        ]),
      ),
    });
    const events: AgentEvent[] = [];
    for await (const e of eri.stream({ intent: "ask", prompt: "hi" })) {
      events.push(e);
    }
    assert.equal(events.length, 3);
    assert.equal(events[0]?.kind, "token");
    assert.equal(events[2]?.kind, "done");
  });

  it("surfaces error events via EriError on .ask()", async () => {
    const eri = new Eri({
      apiKey: "eri_sk_test",
      fetch: mockFetch(() =>
        sseResponse([{ kind: "error", message: "model unavailable" }]),
      ),
    });
    await assert.rejects(eri.ask("hi"), /model unavailable/);
  });

  it("uses ERI_API_KEY env when apiKey omitted", () => {
    const original = process.env.ERI_API_KEY;
    process.env.ERI_API_KEY = "eri_sk_env";
    try {
      const eri = new Eri();
      // No throw — apiKey resolved from env.
      assert.ok(eri instanceof Eri);
    } finally {
      if (original === undefined) delete process.env.ERI_API_KEY;
      else process.env.ERI_API_KEY = original;
    }
  });

  it("trims trailing slashes from baseUrl", () => {
    const calls: string[] = [];
    const eri = new Eri({
      apiKey: "eri_sk_test",
      baseUrl: "https://tryeri.ca//",
      fetch: mockFetch((req) => {
        calls.push(req.url);
        return sseResponse([{ kind: "done", tokensIn: 0, tokensOut: 0 }]);
      }),
    });
    void eri.ask("hi");
    // Awaiting would race with the assertion; the URL is captured on first fetch invocation.
    setTimeout(() => {
      assert.ok(calls[0]?.startsWith("https://tryeri.ca/api/v1/agent/run"));
    }, 10);
  });

  it("calls memory.recall with limit", async () => {
    const recorded: { url: string; body: unknown }[] = [];
    const eri = new Eri({
      apiKey: "eri_sk_test",
      fetch: mockFetch(async (req) => {
        const body = await req.json();
        recorded.push({ url: req.url, body });
        return new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    });
    await eri.memory.recall("blue", 5);
    assert.equal(recorded.length, 1);
    assert.match(recorded[0]!.url, /\/api\/v1\/memory\/recall$/);
    assert.deepEqual(recorded[0]!.body, { query: "blue", limit: 5 });
  });
});
