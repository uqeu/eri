import { strict as assert } from "node:assert";
import {
  handleInbound,
  REPLY,
  type InboundDeps,
} from "../imessage/inbound";
import type { InboundMessage } from "../imessage/webhook";

function msg(content: string): InboundMessage {
  return {
    fromNumber: "+16475497552",
    content,
    messageHandle: "h1",
    isOutbound: false,
    service: "iMessage",
  };
}

// A baseline dep set; each test overrides the parts it exercises.
function deps(over: Partial<InboundDeps> = {}): InboundDeps {
  return {
    consumePairing: async () => null,
    resolveUserByPhone: async () => ({ userId: "u1", tier: "pro_plus" }),
    withinQuota: async () => true,
    loadProfile: async () => ({ profile: { facts: ["likes tabs"] }, dynamicContext: "" }),
    runTurn: async () => ({ text: "**hi**", tokensIn: 10, tokensOut: 5, model: "claude-sonnet-4-6" }),
    now: () => 1000,
    ...over,
  };
}

async function run() {
  // Pairing code that matches → linked, no meter.
  {
    const out = await handleInbound(msg("ABC123"), "+1", deps({ consumePairing: async () => ({ userId: "u1" }) }));
    assert.equal(out.branch, "paired");
    assert.deepEqual(out.replyChunks, [REPLY.linked]);
    assert.equal(out.meter, null);
  }

  // Unknown number → not linked, no meter.
  {
    const out = await handleInbound(msg("hello"), "+1", deps({ resolveUserByPhone: async () => null }));
    assert.equal(out.branch, "not_linked");
    assert.equal(out.meter, null);
  }

  // Linked but not Pro+ → locked.
  {
    const out = await handleInbound(msg("hello"), "+1", deps({ resolveUserByPhone: async () => ({ userId: "u1", tier: "pro" }) }));
    assert.equal(out.branch, "locked");
  }

  // Over quota → friendly message, no model call, no meter.
  {
    let called = false;
    const out = await handleInbound(msg("hello"), "+1", deps({
      withinQuota: async () => false,
      runTurn: async () => { called = true; throw new Error("should not run"); },
    }));
    assert.equal(out.branch, "over_quota");
    assert.equal(called, false, "must not call the model when over quota");
    assert.equal(out.meter, null);
  }

  // Happy path → answered, markdown stripped, meter recorded with tokens.
  {
    const out = await handleInbound(msg("what's up?"), "+1", deps());
    assert.equal(out.branch, "answered");
    assert.deepEqual(out.replyChunks, ["hi"], "markdown stripped for iMessage");
    assert.equal(out.meter?.status, "ok");
    assert.equal(out.meter?.tokensOut, 5);
  }

  // Model throws → errored reply + an error meter (so the turn is still counted).
  {
    const out = await handleInbound(msg("boom"), "+1", deps({ runTurn: async () => { throw new Error("anthropic 500"); } }));
    assert.equal(out.branch, "errored");
    assert.equal(out.replyChunks[0], REPLY.errored);
    assert.equal(out.meter?.status, "error");
  }

  // eslint-disable-next-line no-console
  console.log("imessage-inbound.test.ts: all assertions passed");
}

run();
