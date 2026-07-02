import { strict as assert } from "node:assert";
import { classifyCodingIntent } from "../coding/intent";
import { startCodingJob, type KickoffDeps } from "../coding/kickoff";
import { eventBubbles, newBubblesFromRecord, streamJob, type StatusSink } from "../coding/stream";
import { relayReviewComment, type ReviewDeps } from "../coding/review";
import type {
  CodeJobClient,
  CodeJobRecord,
  CodeOutcome,
  CodeProgress,
  RepoResolution,
} from "../coding/contract";

// ── A scripted CodeJobClient: canned start id, a record progression returned by
//    successive fetchRecord calls, and capture hooks for start/comment. This is the
//    stand-in for the real POST+poll transport (contract-identical). ────────────
function scriptedClient(opts: {
  jobId?: string;
  records?: CodeJobRecord[];
  onStart?: (input: { userId: string; task: string; repo: string }) => void;
  onComment?: (input: { jobId: string; comment: string }) => void;
  throwFirstFetch?: boolean;
}): CodeJobClient {
  let fetches = 0;
  return {
    start: async (input) => {
      opts.onStart?.({ userId: input.userId, task: input.task, repo: input.repo });
      return { jobId: opts.jobId ?? "job_x" };
    },
    fetchRecord: async () => {
      const recs = opts.records ?? [];
      const n = fetches++;
      if (opts.throwFirstFetch && n === 0) throw new Error("poll blip");
      const idx = opts.throwFirstFetch ? n - 1 : n;
      return recs[Math.min(Math.max(idx, 0), recs.length - 1)];
    },
    comment: async (input) => opts.onComment?.(input),
  };
}

function sink(): StatusSink & { bubbles: string[]; typings: number } {
  const state = { bubbles: [] as string[], typings: 0 };
  return {
    bubbles: state.bubbles,
    get typings() { return state.typings; },
    sendTyping: async () => { state.typings++; },
    sendBubbles: async (chunks) => { state.bubbles.push(...chunks); },
  };
}

const plan: CodeProgress = { stage: "plan", text: "on it — reproducing the failing checkout test" };
const testGreen: CodeProgress = { stage: "test", text: "tests pass ✓ — 42 passed", command: "cargo test", passed: true };
const testRed: CodeProgress = { stage: "test", text: "still red — 1 failing", passed: false };
const prEvent: CodeProgress = { stage: "pr", text: "opened PR #123 — https://github.com/eri-labs/eri/pull/123", number: 123, url: "https://github.com/eri-labs/eri/pull/123" };
const openedOutcome: CodeOutcome = { kind: "opened", text: "PR #123 — fixes the null-cart case, tests pass. https://github.com/eri-labs/eri/pull/123", number: 123, url: "https://github.com/eri-labs/eri/pull/123" };
const testsRedOutcome: CodeOutcome = { kind: "testsRed", text: "couldn't get it green — checkout still red after 3 attempts. i didn't open a PR.", summary: "checkout still red after 3 attempts" };

function record(over: Partial<CodeJobRecord>): CodeJobRecord {
  return { jobId: "job_x", repo: "eri-labs/eri", phase: "running", prNumber: null, events: [], outcome: null, ...over };
}

function kickoffDeps(over: Partial<KickoffDeps> & { resolution?: RepoResolution } = {}): KickoffDeps {
  return {
    client: over.client ?? scriptedClient({}),
    resolveRepo: over.resolveRepo ?? (async () => over.resolution ?? { kind: "resolved", repo: "eri-labs/eri" }),
    connectUrl: over.connectUrl ?? (async () => "https://tryeri.ca/connect/github?u=u1"),
  };
}

async function run() {
  // ── P4 + P2 kickoff: repo resolves → job starts, instant ack, start gets task+repo ──
  {
    let started: { userId: string; task: string; repo: string } | null = null;
    const intent = classifyCodingIntent("the checkout test is failing in eri, fix it")!;
    const res = await startCodingJob("u1", intent, kickoffDeps({
      client: scriptedClient({ jobId: "job_42", onStart: (i) => { started = i; } }),
      resolution: { kind: "resolved", repo: "eri-labs/eri" },
    }));
    assert.equal(res.kind, "started");
    if (res.kind === "started") {
      assert.equal(res.jobId, "job_42");
      assert.equal(res.repo, "eri-labs/eri");
      assert.ok(res.ack.toLowerCase().includes("eri-labs/eri"), "ack names the repo");
    }
    assert.equal(started!.task, intent.task, "the brain gets the user's task verbatim");
    assert.equal(started!.repo, "eri-labs/eri");
  }

  // ── P4: repo not linked → connect prompt with URL; the job is NOT started ──────
  {
    let startCalled = false;
    const intent = classifyCodingIntent("fix the failing test in acme")!;
    const res = await startCodingJob("u1", intent, kickoffDeps({
      client: scriptedClient({ onStart: () => { startCalled = true; } }),
      resolution: { kind: "needs_connect", hint: "acme" },
      connectUrl: async () => "https://tryeri.ca/connect/github?u=u1",
    }));
    assert.equal(res.kind, "needs_connect");
    if (res.kind === "needs_connect") {
      assert.ok(res.ack.includes("https://tryeri.ca/connect/github?u=u1"), "connect prompt carries the URL");
      assert.ok(res.ack.includes("acme"), "connect prompt names the repo hint");
    }
    assert.equal(startCalled, false, "a job is never started for an unlinked repo (single-principal)");
  }

  // ── P4: ambiguous / no repo hint → ask which repo; job NOT started ────────────
  for (const resolution of [{ kind: "ambiguous", hint: null } as RepoResolution, { kind: "no_hint" } as RepoResolution]) {
    let startCalled = false;
    const intent = classifyCodingIntent("fix the failing tests")!;
    const res = await startCodingJob("u1", intent, kickoffDeps({
      client: scriptedClient({ onStart: () => { startCalled = true; } }),
      resolution,
    }));
    assert.equal(res.kind, "ask");
    assert.equal(startCalled, false);
  }

  // ── eventBubbles: text sent verbatim (markdown-safe, length-chunked); empty → none ──
  {
    assert.deepEqual(eventBubbles(plan), [plan.text]);
    assert.deepEqual(eventBubbles(openedOutcome), [openedOutcome.text]);
    assert.deepEqual(eventBubbles({ stage: "edit", text: "   " }), [], "blank text sends no bubble");
    // markdown is stripped for iMessage (verbatim = eri's words, not raw markdown noise).
    assert.deepEqual(eventBubbles({ stage: "commit", text: "committed **fix** the `cart`" }), ["committed fix the cart"]);
  }

  // ── newBubblesFromRecord: only NEW events; settled appends the outcome text ────
  {
    const running = record({ events: [plan, testGreen] });
    const first = newBubblesFromRecord(running, 0);
    assert.deepEqual(first.bubbles, [plan.text, testGreen.text]);
    assert.equal(first.sent, 2);
    assert.equal(first.settled, false);

    const noNew = newBubblesFromRecord(running, 2);
    assert.deepEqual(noNew.bubbles, [], "nothing new since the last poll");

    const settled = record({ phase: "settled", events: [plan, testGreen, prEvent], outcome: openedOutcome, prNumber: 123 });
    const last = newBubblesFromRecord(settled, 2);
    assert.deepEqual(last.bubbles, [prEvent.text, openedOutcome.text], "the new pr event + the outcome bubble");
    assert.equal(last.settled, true);
    assert.equal(last.outcome?.kind, "opened");
  }

  // ── P2: streamJob drives the poll loop → ordered bubbles, typing between, never silent ──
  {
    const s = sink();
    const client = scriptedClient({
      records: [
        record({ events: [plan] }),
        record({ events: [plan, testGreen] }),
        record({ phase: "settled", events: [plan, testGreen, prEvent], outcome: openedOutcome, prNumber: 123 }),
      ],
    });
    const outcome = await streamJob(client, "job_x", s, { sleep: async () => {}, pollMs: 0 });
    assert.deepEqual(s.bubbles, [plan.text, testGreen.text, prEvent.text, openedOutcome.text]);
    assert.equal(outcome?.kind, "opened");
    assert.ok(s.typings >= 2, "typing shown between milestones so eri never goes silent");
  }

  // ── P2 fail-closed: a testsRed job streams the red result + the summary, NO PR bubble ──
  {
    const s = sink();
    const client = scriptedClient({
      records: [
        record({ events: [plan, testRed] }),
        record({ phase: "settled", events: [plan, testRed], outcome: testsRedOutcome }),
      ],
    });
    const outcome = await streamJob(client, "job_x", s, { sleep: async () => {}, pollMs: 0 });
    assert.equal(outcome?.kind, "testsRed");
    assert.ok(s.bubbles.some((b) => b.includes("still red")), "the red test result is relayed");
    assert.ok(s.bubbles.some((b) => b === testsRedOutcome.text), "the fail-closed summary is the closing bubble");
    assert.equal(s.bubbles.some((b) => /PR #\d+|pull\//.test(b)), false, "no PR is ever announced when tests are red");
  }

  // ── P2: a transient poll error is retried, not fatal ──────────────────────────
  {
    const s = sink();
    const client = scriptedClient({
      throwFirstFetch: true,
      records: [record({ phase: "settled", events: [plan], outcome: openedOutcome, prNumber: 123 })],
    });
    const outcome = await streamJob(client, "job_x", s, { sleep: async () => {}, pollMs: 0, maxPolls: 5 });
    assert.equal(outcome?.kind, "opened", "a poll blip is retried, the job still completes");
  }

  // ── P3: a review comment with an active job routes back to the SAME job ────────
  {
    let relayed: { jobId: string; comment: string } | null = null;
    const deps: ReviewDeps = {
      client: scriptedClient({ onComment: (i) => { relayed = i; } }),
      activeJob: async () => ({ jobId: "job_42", prNumber: 123 }),
    };
    const res = await relayReviewComment("u1", "rename the helper to settleCart and re-run", deps);
    assert.ok(res, "an active job → the comment is relayed");
    assert.equal(relayed!.jobId, "job_42", "routed to the same job by id, not a new PR");
    assert.equal(relayed!.comment, "rename the helper to settleCart and re-run");
    assert.ok(res!.ack.includes("123"), "the ack references the PR");
  }

  // ── P3: no active job → null, so the message falls through to normal classify/chat ──
  {
    const deps: ReviewDeps = {
      client: scriptedClient({ onComment: () => { throw new Error("should not relay"); } }),
      activeJob: async () => null,
    };
    assert.equal(await relayReviewComment("u1", "looks good, thanks", deps), null);
  }

  // ── Integrated: classify → kickoff → stream, the whole demo path against the mock ──
  {
    const s = sink();
    const intent = classifyCodingIntent("the checkout test is failing on main in eri, fix it")!;
    const kicked = await startCodingJob("u1", intent, kickoffDeps({ resolution: { kind: "resolved", repo: "eri-labs/eri" } }));
    assert.equal(kicked.kind, "started");
    const client = scriptedClient({
      records: [
        record({ events: [plan] }),
        record({ phase: "settled", events: [plan, testGreen, prEvent], outcome: openedOutcome, prNumber: 123 }),
      ],
    });
    const outcome = await streamJob(client, "job_x", s, { sleep: async () => {}, pollMs: 0 });
    assert.equal(outcome?.kind, "opened");
    assert.ok(s.bubbles.at(-1)!.includes("pull/123"), "the last bubble is the PR-link reply");
  }

  // eslint-disable-next-line no-console
  console.log("coding-flow.test.ts: all assertions passed");
}

run();
