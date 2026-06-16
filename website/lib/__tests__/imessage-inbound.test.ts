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
    enqueueComputerGoal: async () => true,
    rememberUserFact: async () => true,
    confirmPending: async () => null,
    cancelPending: async () => false,
    now: () => 1000,
    ...over,
  };
}

async function run() {
  // Unknown number texts a valid pairing code → linked, no meter.
  {
    const out = await handleInbound(
      msg("ABC123"),
      "+1",
      deps({ resolveUserByPhone: async () => null, consumePairing: async () => ({ userId: "u1" }) }),
    );
    assert.equal(out.branch, "paired");
    assert.deepEqual(out.replyChunks, [REPLY.linked]);
    assert.equal(out.meter, null);
  }

  // Unknown number, no valid code → not linked, no meter.
  {
    const out = await handleInbound(msg("hello"), "+1", deps({ resolveUserByPhone: async () => null }));
    assert.equal(out.branch, "not_linked");
    assert.equal(out.meter, null);
  }

  // A LINKED user texting something code-shaped is answered, not treated as pairing (L3).
  {
    let pairingTried = false;
    const out = await handleInbound(
      msg("Sounds"),
      "+1",
      deps({ consumePairing: async () => { pairingTried = true; return { userId: "x" }; } }),
    );
    assert.equal(out.branch, "answered");
    assert.equal(pairingTried, false, "must not attempt pairing for a known user");
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

  // The model's control_computer tool call dispatches a goal to the queue.
  {
    let enqueued: { userId: string; goal: string } | null = null;
    const out = await handleInbound(
      msg("open Spotify on my computer"),
      "+1",
      deps({
        enqueueComputerGoal: async (userId, goal) => { enqueued = { userId, goal }; return true; },
        // Simulate the loop: the model calls control_computer, then answers.
        runTurn: async (input) => {
          await input.onToolCall!("control_computer", { goal: "open Spotify" });
          return { text: "On it 🌿", tokensIn: 8, tokensOut: 4, model: "claude-sonnet-4-6" };
        },
      }),
    );
    assert.equal(out.branch, "answered");
    assert.deepEqual(enqueued, { userId: "u1", goal: "open Spotify" });
  }

  // A recall_memory tool call relays a deep-memory lookup to the computer
  // (Tier-B is E2E — the cloud can't read it), as a typed `recall` turn whose
  // goal is a structured {query, as_of} spec the computer parses.
  {
    let enqueued: { userId: string; goal: string; kind?: string } | null = null;
    const out = await handleInbound(
      msg("what did I decide about the Henderson deal?"),
      "+1",
      deps({
        enqueueComputerGoal: async (userId, goal, kind) => { enqueued = { userId, goal, kind }; return true; },
        runTurn: async (input) => {
          await input.onToolCall!("recall_memory", { query: "the Henderson deal decision", as_of: "last month" });
          return { text: "Checking your memory 🌿", tokensIn: 8, tokensOut: 4, model: "claude-sonnet-4-6" };
        },
      }),
    );
    assert.equal(out.branch, "answered");
    assert.equal(enqueued!.userId, "u1");
    assert.equal(enqueued!.kind, "recall");
    const spec = JSON.parse(enqueued!.goal);
    assert.equal(spec.query, "the Henderson deal decision");
    assert.equal(spec.as_of, "last month");
  }

  // Only one dispatch per text: a second tool call in the same turn is refused.
  {
    let count = 0;
    await handleInbound(
      msg("open Spotify and recall my notes"),
      "+1",
      deps({
        enqueueComputerGoal: async () => { count++; return true; },
        runTurn: async (input) => {
          await input.onToolCall!("control_computer", { goal: "open Spotify" });
          const second = await input.onToolCall!("recall_memory", { query: "my notes" });
          assert.match(second, /Already dispatched/);
          return { text: "On it 🌿", tokensIn: 8, tokensOut: 4, model: "claude-sonnet-4-6" };
        },
      }),
    );
    assert.equal(count, 1, "the single-dispatch guard spans both tools");
  }

  // remember_fact saves to cloud memory in-cloud (no dispatch) AND can co-occur
  // with a computer dispatch in the same turn (it bypasses the single-dispatch guard).
  {
    let saved: { fact: string; kind: string } | null = null;
    let dispatches = 0;
    const out = await handleInbound(
      msg("I live in Toronto, now open Spotify"),
      "+1",
      deps({
        rememberUserFact: async (_u, fact, kind) => { saved = { fact, kind }; return true; },
        enqueueComputerGoal: async () => { dispatches++; return true; },
        runTurn: async (input) => {
          const r = await input.onToolCall!("remember_fact", { fact: "Lives in Toronto", kind: "fact" });
          assert.match(r, /Saved/);
          await input.onToolCall!("control_computer", { goal: "open Spotify" });
          return { text: "got it 🌿", tokensIn: 8, tokensOut: 4, model: "claude-haiku-4-5-20251001" };
        },
      }),
    );
    assert.equal(out.branch, "answered");
    assert.deepEqual(saved, { fact: "Lives in Toronto", kind: "fact" });
    assert.equal(dispatches, 1, "remember_fact did not consume the dispatch slot");
  }

  // A natural "go ahead" with a pending confirmation approves it (no model turn).
  {
    let confirmed = false;
    const out = await handleInbound(
      msg("go ahead"),
      "+1",
      deps({
        confirmPending: async () => { confirmed = true; return { goal: "send the email" }; },
        runTurn: async () => { throw new Error("should not run a turn"); },
      }),
    );
    assert.equal(out.branch, "confirmed");
    assert.equal(confirmed, true);
    assert.equal(out.meter, null);
  }

  // "no" with a pending confirmation cancels it.
  {
    const out = await handleInbound(msg("no"), "+1", deps({ cancelPending: async () => true }));
    assert.equal(out.branch, "cancelled");
  }

  // A natural "yes" with NOTHING pending falls through to a normal answer.
  {
    const out = await handleInbound(msg("yes"), "+1", deps());
    assert.equal(out.branch, "answered");
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
