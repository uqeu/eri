import { strict as assert } from "node:assert";
import {
  handleInbound,
  REPLY,
  type InboundDeps,
} from "../imessage/inbound";
import type { InboundMessage } from "../imessage/webhook";
import type { CodingIntent } from "../coding/intent";

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
    mintSignupLink: async () => "https://tryeri.ca/join?t=test123",
    withinQuota: async () => true,
    loadProfile: async () => ({ profile: { facts: ["likes tabs"] }, dynamicContext: "" }),
    runTurn: async () => ({ text: "**hi**", tokensIn: 10, tokensOut: 5, model: "claude-sonnet-4-6" }),
    enqueueComputerGoal: async () => true,
    rememberUserFact: async () => true,
    connectors: {
      activeToolkits: async () => new Set<string>(),
      executeTool: async () => ({ data: {}, error: null, successful: false }),
    },
    webSearch: { runSearch: async () => [] },
    weather: { fetchJson: async () => ({}) },
    runVisionTurn: async () => ({ text: "i see it", tokensIn: 5, tokensOut: 3, model: "claude-sonnet-4-6" }),
    loadConversation: async () => [],
    recordConversation: async () => {},
    recordSignal: async () => {},
    rejectRecentSignal: async () => {},
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
    assert.ok(out.replyChunks[0].includes("join?t=test123"), "unknown number gets a magic sign-up link");
  }

  // If minting the signup link fails, fall back to the generic reply (never crash).
  {
    const out = await handleInbound(
      msg("hello"),
      "+1",
      deps({ resolveUserByPhone: async () => null, mintSignupLink: async () => { throw new Error("db down"); } }),
    );
    assert.equal(out.branch, "not_linked");
    assert.deepEqual(out.replyChunks, [REPLY.notLinked]);
  }

  // Invite-by-number: an un-bound number with a PENDING invite auto-onboards on the
  // first text — no link, no sign-up form; the welcome names the inviter.
  {
    let mintTried = false;
    const out = await handleInbound(
      msg("hey"),
      "+1",
      deps({
        resolveUserByPhone: async () => null,
        acceptPendingInvite: async () => ({ userId: "u_friend", inviterName: "Khai" }),
        mintSignupLink: async () => { mintTried = true; return "x"; },
      }),
    );
    assert.equal(out.branch, "invited");
    assert.equal(out.meter, null);
    assert.ok(out.replyChunks[0].includes("Khai added you"), "welcome names the inviter");
    assert.equal(mintTried, false, "an invited number is auto-onboarded, never sent a sign-up link");
  }

  // No pending invite → falls through to the magic-link flow (unchanged).
  {
    const out = await handleInbound(
      msg("hey"),
      "+1",
      deps({ resolveUserByPhone: async () => null, acceptPendingInvite: async () => null }),
    );
    assert.equal(out.branch, "not_linked");
    assert.ok(out.replyChunks[0].includes("join?t=test123"));
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

  // A photo (mediaUrl) routes to the vision turn, not the normal text turn.
  {
    let visionImg: string | null = null;
    let textRan = false;
    const out = await handleInbound(
      { ...msg("what's this?"), mediaUrl: "https://cdn.example/x.jpg" },
      "+1",
      deps({
        runVisionTurn: async ({ imageUrl }) => { visionImg = imageUrl; return { text: "looks like a receipt", tokensIn: 9, tokensOut: 6, model: "claude-sonnet-4-6" }; },
        runTurn: async () => { textRan = true; throw new Error("text turn must not run for a photo"); },
      }),
    );
    assert.equal(out.branch, "answered");
    assert.equal(visionImg, "https://cdn.example/x.jpg");
    assert.equal(textRan, false, "photo must skip the text turn");
    assert.deepEqual(out.replyChunks, ["looks like a receipt"]);
  }

  // check_email / check_calendar resolve IN-CLOUD this turn (no dispatch), so eri
  // answers inbox/day questions with the laptop closed.
  {
    let dispatches = 0;
    const out = await handleInbound(
      msg("anything important in my inbox?"),
      "+1",
      deps({
        connectors: {
          activeToolkits: async () => new Set(["gmail"]),
          executeTool: async () => ({
            data: { messages: [{ from: "boss@co.com", subject: "Q3 numbers", snippet: "need these today" }] },
            error: null,
            successful: true,
          }),
        },
        enqueueComputerGoal: async () => { dispatches++; return true; },
        runTurn: async (input) => {
          const r = await input.onToolCall!("check_email", {});
          assert.match(r, /Q3 numbers/);
          return { text: "boss wants the Q3 numbers today", tokensIn: 8, tokensOut: 6, model: "claude-haiku-4-5-20251001" };
        },
      }),
    );
    assert.equal(out.branch, "answered");
    assert.equal(dispatches, 0, "in-cloud read must not dispatch to the computer");
  }

  // Conversation memory: prior turns are replayed into the turn, and the new
  // exchange is recorded — so eri isn't a one-off AI (it remembers the thread).
  {
    let sawHistory: { role: string; content: string }[] | undefined;
    let recordedUser = "";
    let recordedAssistant = "";
    const out = await handleInbound(
      msg("toronto"),
      "+1",
      deps({
        loadConversation: async () => [
          { role: "assistant", content: "where are you?" },
        ],
        runTurn: async (input) => {
          sawHistory = input.history;
          return { text: "nice, i'll remember you're in toronto", tokensIn: 8, tokensOut: 6, model: "claude-haiku-4-5-20251001" };
        },
        recordConversation: async (_u, user, assistant) => { recordedUser = user; recordedAssistant = assistant; },
      }),
    );
    assert.equal(out.branch, "answered");
    assert.equal(sawHistory?.length, 1, "prior turn must be passed to the model");
    assert.equal(sawHistory?.[0].content, "where are you?");
    assert.equal(recordedUser, "toronto");
    assert.match(recordedAssistant, /toronto/);
  }

  // web_search resolves IN-CLOUD this turn (no dispatch) so eri can answer
  // real-time questions (weather, "google this") directly.
  {
    let searched = "";
    let dispatches = 0;
    const out = await handleInbound(
      msg("what's the weather in mississauga?"),
      "+1",
      deps({
        webSearch: {
          runSearch: async (q) => {
            searched = q;
            return [{ title: "Mississauga weather", url: "https://x", snippet: "12°C, cloudy" }];
          },
        },
        enqueueComputerGoal: async () => { dispatches++; return true; },
        runTurn: async (input) => {
          const r = await input.onToolCall!("web_search", { query: "mississauga weather" });
          assert.match(r, /12°C/);
          return { text: "it's 12 and cloudy in mississauga", tokensIn: 8, tokensOut: 6, model: "claude-haiku-4-5-20251001" };
        },
      }),
    );
    assert.equal(out.branch, "answered");
    assert.equal(searched, "mississauga weather");
    assert.equal(dispatches, 0, "web search must not dispatch to the computer");
  }

  // KTO signal: a normal answer logs a 'kept' signal; a correction flips the prior.
  {
    let recordedPrompt = "";
    let recordedResponse = "";
    await handleInbound(
      msg("what's 2+2"),
      "+1",
      deps({
        runTurn: async () => ({ text: "4", tokensIn: 5, tokensOut: 1, model: "claude-haiku-4-5-20251001" }),
        recordSignal: async (_u, prompt, response) => { recordedPrompt = prompt; recordedResponse = response; },
      }),
    );
    assert.equal(recordedPrompt, "what's 2+2");
    assert.equal(recordedResponse, "4");

    let rejected = false;
    await handleInbound(
      msg("no that's wrong"),
      "+1",
      deps({
        rejectRecentSignal: async () => { rejected = true; },
        runTurn: async () => ({ text: "ah, it's 5", tokensIn: 5, tokensOut: 3, model: "claude-haiku-4-5-20251001" }),
      }),
    );
    assert.equal(rejected, true, "a correction flips the prior reply's signal to rejected");
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

  // ── Phase 3 P1: coding-intent routing ──────────────────────────────────────
  // A coding task, with the dispatch dep wired → routed to the brain's CodeTurn
  // job, NOT the chat model; replies with the job's ack; no phone-side meter (the
  // brain meters the job's own tokens).
  {
    let ranTurn = false;
    const seen: { intent: CodingIntent | null } = { intent: null };
    const out = await handleInbound(
      msg("the checkout test is failing in eri, fix it"),
      "+1",
      deps({
        runTurn: async () => { ranTurn = true; throw new Error("should not chat"); },
        dispatchCodingJob: async (_userId, intent) => { seen.intent = intent; return { ack: "on it, cloning eri 🌿" }; },
      }),
    );
    assert.equal(out.branch, "coding");
    assert.equal(ranTurn, false, "a coding task must not hit the chat model");
    assert.equal(out.meter, null, "the brain meters the job, not the phone turn");
    assert.equal(seen.intent?.verb, "fix", "the classified intent reaches the dispatch");
    assert.deepEqual(out.replyChunks, ["on it, cloning eri 🌿"]);
  }

  // Dispatch declines (repo not linked / feature off) → fall through to normal chat.
  {
    const out = await handleInbound(
      msg("fix the failing test in eri"),
      "+1",
      deps({ dispatchCodingJob: async () => null }),
    );
    assert.equal(out.branch, "answered", "a declined coding job falls through to chat");
  }

  // Non-coding text never reaches the coding dispatch, even when it's wired.
  {
    let dispatched = false;
    const out = await handleInbound(
      msg("what was I working on?"),
      "+1",
      deps({ dispatchCodingJob: async () => { dispatched = true; return { ack: "x" }; } }),
    );
    assert.equal(out.branch, "answered");
    assert.equal(dispatched, false, "chat messages don't reach the coding dispatch");
  }

  // Additive: with NO dispatch dep wired (today's prod), a coding-shaped message
  // is answered as normal chat — zero behavior change until P2 wires the contract.
  {
    const out = await handleInbound(msg("fix the failing test in eri"), "+1", deps());
    assert.equal(out.branch, "answered");
  }

  // Over quota short-circuits before any coding dispatch (a job costs tokens too).
  {
    let dispatched = false;
    const out = await handleInbound(
      msg("fix the failing test in eri"),
      "+1",
      deps({ withinQuota: async () => false, dispatchCodingJob: async () => { dispatched = true; return { ack: "x" }; } }),
    );
    assert.equal(out.branch, "over_quota");
    assert.equal(dispatched, false, "over-quota users don't kick off a coding job");
  }

  // eslint-disable-next-line no-console
  console.log("imessage-inbound.test.ts: all assertions passed");
}

run();
