// Pure-logic tests for the eri account module. Run with:
//   node out/account/__tests__/account.test.js
//
// We stub vscode in the require cache so importing types/sessionStore that
// reference vscode types succeeds without a real extension host.

import { strict as assert } from "node:assert";

const Module = require("module") as {
  _resolveFilename: (req: string, parent: unknown) => string;
  _cache: Record<string, unknown>;
};
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, parent: unknown) {
  if (request === "vscode") return "vscode";
  return originalResolve.call(this, request, parent);
};

class StubEmitter<T> {
  private readonly listeners: Array<(v: T) => void> = [];
  fire(v: T): void {
    for (const l of this.listeners) l(v);
  }
  get event(): (l: (v: T) => void) => { dispose: () => void } {
    return (l) => {
      this.listeners.push(l);
      return { dispose: () => undefined };
    };
  }
  dispose(): void {
    this.listeners.length = 0;
  }
}

Module._cache["vscode"] = {
  exports: {
    EventEmitter: StubEmitter,
    Disposable: class {
      constructor(private readonly fn: () => void) {}
      dispose(): void {
        this.fn();
      }
    },
    workspace: { getConfiguration: () => ({ get: <T>(_: string, d: T) => d }) },
    window: {},
    commands: {},
    env: {},
    Uri: { parse: (s: string) => ({ toString: () => s }) },
  },
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SessionStore } = require("../sessionStore") as typeof import("../sessionStore");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DeviceCodeFlow, DeviceCodeError } =
  require("../deviceCodeFlow") as typeof import("../deviceCodeFlow");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UsageClient, remainingIncludedPct } =
  require("../usageClient") as typeof import("../usageClient");
import type { EriSession, UsageSummary } from "../types";

class FakeSecrets {
  private readonly map = new Map<string, string>();
  get(k: string): Promise<string | undefined> { return Promise.resolve(this.map.get(k)); }
  store(k: string, v: string): Promise<void> { this.map.set(k, v); return Promise.resolve(); }
  delete(k: string): Promise<void> { this.map.delete(k); return Promise.resolve(); }
}
class FakeMemento {
  private readonly map = new Map<string, unknown>();
  get<T>(k: string): T | undefined { return this.map.get(k) as T | undefined; }
  update(k: string, v: unknown): Promise<void> {
    if (v === undefined) this.map.delete(k);
    else this.map.set(k, v);
    return Promise.resolve();
  }
}

async function testSessionStoreRoundTrip(): Promise<void> {
  const secrets = new FakeSecrets();
  const memento = new FakeMemento();
  const store = new SessionStore(secrets, memento);
  await store.hydrate();
  assert.equal(store.isSignedIn(), false);

  const session: EriSession = {
    token: "tok_abc",
    userId: "u_1",
    email: "khai@example.com",
    tier: "pro",
    signedInAt: "2026-05-24T00:00:00.000Z",
  };
  await store.set(session);
  assert.equal(store.isSignedIn(), true);

  const fresh = new SessionStore(secrets, memento);
  await fresh.hydrate();
  const got = await fresh.get();
  assert.ok(got);
  assert.equal(got?.token, "tok_abc");
  assert.equal(got?.email, "khai@example.com");
  assert.equal(got?.tier, "pro");

  await fresh.clear();
  assert.equal(fresh.isSignedIn(), false);
  const reread = new SessionStore(secrets, memento);
  await reread.hydrate();
  assert.equal(await reread.get(), null);
}

async function testSessionStoreRejectsCorruptMetadata(): Promise<void> {
  const secrets = new FakeSecrets();
  const memento = new FakeMemento();
  await memento.update("eri.session.meta.v1", { userId: 1, tier: "wat" });
  const store = new SessionStore(secrets, memento);
  await store.hydrate();
  assert.equal(await store.get(), null);
}

async function testDeviceCodeFlowTimeout(): Promise<void> {
  let nowMs = 0;
  const clock = (): number => nowMs;
  const sleep = (ms: number): Promise<void> => {
    nowMs += ms;
    return Promise.resolve();
  };
  let pollCount = 0;
  const fetchImpl = ((url: string): Promise<Response> => {
    if (url.endsWith("/api/v1/auth/device/start")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            deviceCode: "dc",
            userCode: "ABCD",
            verifyUrl: "https://eri.dev/v",
            pollIntervalSec: 1,
            expiresInSec: 2,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    if (url.endsWith("/api/v1/auth/device/poll")) {
      pollCount += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ status: "pending" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;

  const flow = new DeviceCodeFlow({
    baseUrl: "https://eri.dev",
    fetchImpl,
    clock,
    sleep,
    timeoutMs: 1500,
    opener: { open: () => Promise.resolve() },
  });
  let caught: unknown = null;
  try {
    await flow.run();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof DeviceCodeError, "expected DeviceCodeError");
  assert.equal((caught as InstanceType<typeof DeviceCodeError>).kind, "timeout");
  assert.ok(pollCount >= 1, "should have polled at least once");
}

async function testDeviceCodeFlowApprovesAndFetchesMe(): Promise<void> {
  const sleep = (_ms: number): Promise<void> => Promise.resolve();
  let pollCount = 0;
  const fetchImpl = ((url: string, init?: RequestInit): Promise<Response> => {
    if (url.endsWith("/api/v1/auth/device/start")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            deviceCode: "dc",
            userCode: "ABCD",
            verifyUrl: "https://eri.dev/v",
            pollIntervalSec: 1,
            expiresInSec: 30,
          }),
          { status: 200 },
        ),
      );
    }
    if (url.endsWith("/api/v1/auth/device/poll")) {
      pollCount += 1;
      if (pollCount < 2) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "pending" }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ status: "approved", token: "tok_xyz" }),
          { status: 200 },
        ),
      );
    }
    if (url.endsWith("/api/v1/me")) {
      assert.equal(
        (init?.headers as Record<string, string>)?.authorization,
        "Bearer tok_xyz",
      );
      return Promise.resolve(
        new Response(
          JSON.stringify({ userId: "u_42", email: "k@e.dev", tier: "pro_plus" }),
          { status: 200 },
        ),
      );
    }
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;

  const flow = new DeviceCodeFlow({
    baseUrl: "https://eri.dev",
    fetchImpl,
    sleep,
    timeoutMs: 60_000,
    opener: { open: () => Promise.resolve() },
  });
  const session = await flow.run();
  assert.equal(session.token, "tok_xyz");
  assert.equal(session.userId, "u_42");
  assert.equal(session.tier, "pro_plus");
}

async function testUsageClientHandles401(): Promise<void> {
  let unauthorized = 0;
  let session: EriSession | null = {
    token: "t",
    userId: "u",
    email: "e@e",
    tier: "pro",
    signedInAt: "2026-05-24T00:00:00.000Z",
  };
  const fetchImpl = ((): Promise<Response> =>
    Promise.resolve(new Response("nope", { status: 401 }))) as unknown as typeof fetch;
  const client = new UsageClient({
    getSession: () => session,
    baseUrl: "https://eri.dev",
    fetchImpl,
    onUnauthorized: () => {
      unauthorized += 1;
      session = null;
    },
  });
  const result = await client.fetchUsage();
  assert.equal(result, null);
  assert.equal(unauthorized, 1);
}

async function testUsageClientHandlesOverQuota(): Promise<void> {
  const fetchImpl = ((): Promise<Response> =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          tier: "pro",
          tokensUsed: 1_050_000,
          tokensIncluded: 1_000_000,
          tokensGhost: 200_000,
          remainingIncluded: 0,
          remainingGhost: 150_000,
          softCapWarning: true,
          periodEnd: "2026-06-01T00:00:00.000Z",
        }),
        { status: 200 },
      ),
    )) as unknown as typeof fetch;
  const session: EriSession = {
    token: "t",
    userId: "u",
    email: "e@e",
    tier: "pro",
    signedInAt: "2026-05-24T00:00:00.000Z",
  };
  const client = new UsageClient({
    getSession: () => session,
    baseUrl: "https://eri.dev",
    fetchImpl,
  });
  const usage = await client.fetchUsage();
  assert.ok(usage);
  assert.equal(usage?.softCapWarning, true);
  assert.equal(usage?.remainingIncluded, 0);
}

function testStatusBarPercentage(): void {
  const baseline = (over: Partial<UsageSummary> = {}): UsageSummary => ({
    tier: "pro",
    tokensUsed: 0,
    tokensIncluded: 1000,
    tokensGhost: 0,
    remainingIncluded: 1000,
    remainingGhost: 0,
    softCapWarning: false,
    periodEnd: "",
    ...over,
  });
  assert.equal(Math.round(remainingIncludedPct(baseline())), 100);
  assert.equal(
    Math.round(remainingIncludedPct(baseline({ remainingIncluded: 250 }))),
    25,
  );
  assert.equal(remainingIncludedPct(baseline({ remainingIncluded: 0 })), 0);
  // Clamped negative.
  assert.equal(remainingIncludedPct(baseline({ remainingIncluded: -50 })), 0);
  // Zero capacity returns 0, not NaN.
  assert.equal(
    remainingIncludedPct(baseline({ tokensIncluded: 0, remainingIncluded: 0 })),
    0,
  );
}

async function main(): Promise<void> {
  await testSessionStoreRoundTrip();
  await testSessionStoreRejectsCorruptMetadata();
  await testDeviceCodeFlowTimeout();
  await testDeviceCodeFlowApprovesAndFetchesMe();
  await testUsageClientHandles401();
  await testUsageClientHandlesOverQuota();
  testStatusBarPercentage();
  // eslint-disable-next-line no-console
  console.log("account tests OK");
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
