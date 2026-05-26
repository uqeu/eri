"use strict";
// Pure-logic tests for the eri account module. Run with:
//   node out/account/__tests__/account.test.js
//
// We stub vscode in the require cache so importing types/sessionStore that
// reference vscode types succeeds without a real extension host.
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const Module = require("module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent) {
    if (request === "vscode")
        return "vscode";
    return originalResolve.call(this, request, parent);
};
class StubEmitter {
    listeners = [];
    fire(v) {
        for (const l of this.listeners)
            l(v);
    }
    get event() {
        return (l) => {
            this.listeners.push(l);
            return { dispose: () => undefined };
        };
    }
    dispose() {
        this.listeners.length = 0;
    }
}
Module._cache["vscode"] = {
    exports: {
        EventEmitter: StubEmitter,
        Disposable: class {
            fn;
            constructor(fn) {
                this.fn = fn;
            }
            dispose() {
                this.fn();
            }
        },
        workspace: { getConfiguration: () => ({ get: (_, d) => d }) },
        window: {},
        commands: {},
        env: {},
        Uri: { parse: (s) => ({ toString: () => s }) },
    },
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SessionStore } = require("../sessionStore");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DeviceCodeFlow, DeviceCodeError } = require("../deviceCodeFlow");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UsageClient, remainingIncludedPct } = require("../usageClient");
class FakeSecrets {
    map = new Map();
    get(k) { return Promise.resolve(this.map.get(k)); }
    store(k, v) { this.map.set(k, v); return Promise.resolve(); }
    delete(k) { this.map.delete(k); return Promise.resolve(); }
}
class FakeMemento {
    map = new Map();
    get(k) { return this.map.get(k); }
    update(k, v) {
        if (v === undefined)
            this.map.delete(k);
        else
            this.map.set(k, v);
        return Promise.resolve();
    }
}
async function testSessionStoreRoundTrip() {
    const secrets = new FakeSecrets();
    const memento = new FakeMemento();
    const store = new SessionStore(secrets, memento);
    await store.hydrate();
    node_assert_1.strict.equal(store.isSignedIn(), false);
    const session = {
        token: "tok_abc",
        userId: "u_1",
        email: "khai@example.com",
        tier: "pro",
        signedInAt: "2026-05-24T00:00:00.000Z",
    };
    await store.set(session);
    node_assert_1.strict.equal(store.isSignedIn(), true);
    const fresh = new SessionStore(secrets, memento);
    await fresh.hydrate();
    const got = await fresh.get();
    node_assert_1.strict.ok(got);
    node_assert_1.strict.equal(got?.token, "tok_abc");
    node_assert_1.strict.equal(got?.email, "khai@example.com");
    node_assert_1.strict.equal(got?.tier, "pro");
    await fresh.clear();
    node_assert_1.strict.equal(fresh.isSignedIn(), false);
    const reread = new SessionStore(secrets, memento);
    await reread.hydrate();
    node_assert_1.strict.equal(await reread.get(), null);
}
async function testSessionStoreRejectsCorruptMetadata() {
    const secrets = new FakeSecrets();
    const memento = new FakeMemento();
    await memento.update("eri.session.meta.v1", { userId: 1, tier: "wat" });
    const store = new SessionStore(secrets, memento);
    await store.hydrate();
    node_assert_1.strict.equal(await store.get(), null);
}
async function testDeviceCodeFlowTimeout() {
    let nowMs = 0;
    const clock = () => nowMs;
    const sleep = (ms) => {
        nowMs += ms;
        return Promise.resolve();
    };
    let pollCount = 0;
    const fetchImpl = ((url) => {
        if (url.endsWith("/api/v1/auth/device/start")) {
            return Promise.resolve(new Response(JSON.stringify({
                deviceCode: "dc",
                userCode: "ABCD",
                verifyUrl: "https://eri.dev/v",
                pollIntervalSec: 1,
                expiresInSec: 2,
            }), { status: 200, headers: { "content-type": "application/json" } }));
        }
        if (url.endsWith("/api/v1/auth/device/poll")) {
            pollCount += 1;
            return Promise.resolve(new Response(JSON.stringify({ status: "pending" }), {
                status: 200,
                headers: { "content-type": "application/json" },
            }));
        }
        throw new Error(`unexpected fetch ${url}`);
    });
    const flow = new DeviceCodeFlow({
        baseUrl: "https://eri.dev",
        fetchImpl,
        clock,
        sleep,
        timeoutMs: 1500,
        opener: { open: () => Promise.resolve() },
    });
    let caught = null;
    try {
        await flow.run();
    }
    catch (err) {
        caught = err;
    }
    node_assert_1.strict.ok(caught instanceof DeviceCodeError, "expected DeviceCodeError");
    node_assert_1.strict.equal(caught.kind, "timeout");
    node_assert_1.strict.ok(pollCount >= 1, "should have polled at least once");
}
async function testDeviceCodeFlowApprovesAndFetchesMe() {
    const sleep = (_ms) => Promise.resolve();
    let pollCount = 0;
    const fetchImpl = ((url, init) => {
        if (url.endsWith("/api/v1/auth/device/start")) {
            return Promise.resolve(new Response(JSON.stringify({
                deviceCode: "dc",
                userCode: "ABCD",
                verifyUrl: "https://eri.dev/v",
                pollIntervalSec: 1,
                expiresInSec: 30,
            }), { status: 200 }));
        }
        if (url.endsWith("/api/v1/auth/device/poll")) {
            pollCount += 1;
            if (pollCount < 2) {
                return Promise.resolve(new Response(JSON.stringify({ status: "pending" }), { status: 200 }));
            }
            return Promise.resolve(new Response(JSON.stringify({ status: "approved", token: "tok_xyz" }), { status: 200 }));
        }
        if (url.endsWith("/api/v1/me")) {
            node_assert_1.strict.equal(init?.headers?.authorization, "Bearer tok_xyz");
            return Promise.resolve(new Response(JSON.stringify({ userId: "u_42", email: "k@e.dev", tier: "pro_plus" }), { status: 200 }));
        }
        throw new Error(`unexpected ${url}`);
    });
    const flow = new DeviceCodeFlow({
        baseUrl: "https://eri.dev",
        fetchImpl,
        sleep,
        timeoutMs: 60_000,
        opener: { open: () => Promise.resolve() },
    });
    const session = await flow.run();
    node_assert_1.strict.equal(session.token, "tok_xyz");
    node_assert_1.strict.equal(session.userId, "u_42");
    node_assert_1.strict.equal(session.tier, "pro_plus");
}
async function testUsageClientHandles401() {
    let unauthorized = 0;
    let session = {
        token: "t",
        userId: "u",
        email: "e@e",
        tier: "pro",
        signedInAt: "2026-05-24T00:00:00.000Z",
    };
    const fetchImpl = (() => Promise.resolve(new Response("nope", { status: 401 })));
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
    node_assert_1.strict.equal(result, null);
    node_assert_1.strict.equal(unauthorized, 1);
}
async function testUsageClientHandlesOverQuota() {
    const fetchImpl = (() => Promise.resolve(new Response(JSON.stringify({
        tier: "pro",
        tokensUsed: 1_050_000,
        tokensIncluded: 1_000_000,
        tokensGhost: 200_000,
        remainingIncluded: 0,
        remainingGhost: 150_000,
        softCapWarning: true,
        periodEnd: "2026-06-01T00:00:00.000Z",
    }), { status: 200 })));
    const session = {
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
    node_assert_1.strict.ok(usage);
    node_assert_1.strict.equal(usage?.softCapWarning, true);
    node_assert_1.strict.equal(usage?.remainingIncluded, 0);
}
function testStatusBarPercentage() {
    const baseline = (over = {}) => ({
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
    node_assert_1.strict.equal(Math.round(remainingIncludedPct(baseline())), 100);
    node_assert_1.strict.equal(Math.round(remainingIncludedPct(baseline({ remainingIncluded: 250 }))), 25);
    node_assert_1.strict.equal(remainingIncludedPct(baseline({ remainingIncluded: 0 })), 0);
    // Clamped negative.
    node_assert_1.strict.equal(remainingIncludedPct(baseline({ remainingIncluded: -50 })), 0);
    // Zero capacity returns 0, not NaN.
    node_assert_1.strict.equal(remainingIncludedPct(baseline({ tokensIncluded: 0, remainingIncluded: 0 })), 0);
}
async function main() {
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
main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
});
//# sourceMappingURL=account.test.js.map