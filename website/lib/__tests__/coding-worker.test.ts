import { strict as assert } from "node:assert";
import { parseJsonlLine } from "../coding/jsonl";
import { buildCodeJobArgv } from "../coding/argv";
import { resolveRepoAgainst } from "../coding/resolve";
import { runCodeJob, SANDBOX_CLONE_DIR, type WorkerDeps } from "../coding/worker";
import { makeCodeJobClient, type CodeClientDeps } from "../coding/client";
import { codeJobEnabled } from "../coding/flag";
import type { CodeJobStore } from "../coding/job_store";
import type { CodeJobRecord, CodeOutcome, CodeProgress } from "../coding/contract";

// ── An in-memory CodeJobStore for worker/client tests. ────────────────────────
function memStore(): CodeJobStore & { jobs: Map<string, CodeJobRecord & { userId: string }> } {
  const jobs = new Map<string, CodeJobRecord & { userId: string }>();
  return {
    jobs,
    create: async ({ jobId, userId, repo, task }) => {
      jobs.set(jobId, { jobId, repo, phase: "running", prNumber: null, events: [], outcome: null, userId, task } as CodeJobRecord & { userId: string; task: string });
    },
    appendEvent: async (jobId, event) => { jobs.get(jobId)!.events.push(event); },
    setPrNumber: async (jobId, prNumber) => { jobs.get(jobId)!.prNumber = prNumber; },
    settle: async (jobId, outcome, prNumber) => {
      const j = jobs.get(jobId)!;
      j.phase = "settled"; j.outcome = outcome; j.prNumber = prNumber;
    },
    read: async (jobId) => jobs.get(jobId) ?? null,
    owner: async (jobId) => {
      const j = jobs.get(jobId);
      return j ? { userId: j.userId, repo: j.repo, prNumber: j.prNumber } : null;
    },
    activeJob: async (userId) => {
      for (const j of jobs.values()) if (j.userId === userId && j.phase === "running") return { jobId: j.jobId, prNumber: j.prNumber };
      return null;
    },
    markBubblesSent: async () => {},
  };
}

/** A scripted sandbox: yields the given stdout lines, records what it was called with. */
function scriptedSandbox(lines: string[], sink?: { calledWith?: unknown; tornDown?: boolean }) {
  return async function* (input: unknown): AsyncIterable<string> {
    if (sink) sink.calledWith = input;
    for (const l of lines) yield l;
    if (sink) sink.tornDown = true; // generator ran to completion = sandbox torn down
  };
}

async function run() {
  // ── JSONL parsing: stage → progress, kind → outcome, junk → null ─────────────
  {
    const p = parseJsonlLine('{"stage":"test","text":"tests pass ✓","passed":true}');
    assert.equal(p?.kind, "progress");
    if (p?.kind === "progress") { assert.equal(p.event.stage, "test"); assert.equal(p.event.text, "tests pass ✓"); }

    const o = parseJsonlLine('{"kind":"opened","text":"PR #12 — green","number":12,"url":"https://x/pull/12"}');
    assert.equal(o?.kind, "outcome");
    if (o?.kind === "outcome") { assert.equal(o.outcome.kind, "opened"); assert.equal(o.outcome.number, 12); }

    assert.equal(parseJsonlLine("not json — a stderr line leaked"), null, "non-JSON ignored");
    assert.equal(parseJsonlLine('{"stage":"bogus","text":"x"}'), null, "unknown stage rejected");
    assert.equal(parseJsonlLine('{"kind":"bogus","text":"x"}'), null, "unknown kind rejected");
    assert.equal(parseJsonlLine("   "), null, "blank ignored");
    // Defensive: an outcome with no text still yields a (fallback) bubble so we never go silent.
    const noText = parseJsonlLine('{"kind":"testsRed","summary":"still red"}');
    assert.equal(noText?.kind, "outcome");
    if (noText?.kind === "outcome") assert.ok(noText.outcome.text.trim().length > 0, "outcome always has bubble text");
  }

  // ── argv: exact flags, optionals omitted when absent ─────────────────────────
  {
    assert.deepEqual(
      buildCodeJobArgv({ task: "fix the null cart", workingTree: "/sandbox/clone" }),
      ["code-job", "--task", "fix the null cart", "--repo", "/sandbox/clone"],
    );
    assert.deepEqual(
      buildCodeJobArgv({
        task: "fix x", workingTree: "/r", slug: "eri-labs/eri", base: "main",
        testCmd: "cargo test", budgetTokens: 400000, budgetSeconds: 900,
        updatePr: { number: 123, url: "https://github.com/eri-labs/eri/pull/123" },
      }),
      [
        "code-job", "--task", "fix x", "--repo", "/r",
        "--slug", "eri-labs/eri", "--base", "main", "--test-cmd", "cargo test",
        "--budget-tokens", "400000", "--budget-seconds", "900",
        "--update-pr", "123", "--update-pr-url", "https://github.com/eri-labs/eri/pull/123",
      ],
    );
  }

  // ── resolveRepoAgainst: single-principal, only the user's connected repos ─────
  {
    assert.deepEqual(resolveRepoAgainst("eri", ["eri-labs/eri"]), { kind: "resolved", repo: "eri-labs/eri" });
    assert.deepEqual(resolveRepoAgainst("eri-labs/eri", ["eri-labs/eri"]), { kind: "resolved", repo: "eri-labs/eri" });
    assert.deepEqual(resolveRepoAgainst("acme", ["eri-labs/eri"]), { kind: "needs_connect", hint: "acme" });
    assert.deepEqual(resolveRepoAgainst("eri-labs/eri", []), { kind: "needs_connect", hint: "eri-labs/eri" });
    assert.equal(resolveRepoAgainst("eri", ["a/eri", "b/eri"]).kind, "ambiguous");
    assert.deepEqual(resolveRepoAgainst(null, ["eri-labs/eri"]), { kind: "resolved", repo: "eri-labs/eri" });
    assert.deepEqual(resolveRepoAgainst(null, []), { kind: "needs_connect", hint: null });
    assert.equal(resolveRepoAgainst(null, ["a/x", "b/y"]).kind, "no_hint");
  }

  // ── runCodeJob: stream JSONL → append events → set pr → settle; token injected ─
  {
    const store = memStore();
    await store.create({ jobId: "job_1", userId: "u1", repo: "eri-labs/eri", task: "fix it" });
    const sink: { calledWith?: unknown; tornDown?: boolean } = {};
    const deps: WorkerDeps = {
      store,
      githubToken: async () => "ghtok_secret",
      runSandbox: scriptedSandbox([
        '{"stage":"plan","text":"on it — reproducing"}',
        'a diagnostic line on stdout that is not json',
        '{"stage":"test","text":"tests pass ✓","passed":true}',
        '{"stage":"pr","text":"opened PR #7","number":7,"url":"https://github.com/eri-labs/eri/pull/7"}',
        '{"kind":"opened","text":"PR #7 — green","number":7,"url":"https://github.com/eri-labs/eri/pull/7"}',
      ], sink),
    };
    const outcome = await runCodeJob({ jobId: "job_1", userId: "u1", repo: "eri-labs/eri", task: "fix it" }, deps);
    const rec = store.jobs.get("job_1")!;
    assert.equal(rec.phase, "settled");
    assert.equal(outcome?.kind, "opened");
    assert.deepEqual(rec.events.map((e) => e.stage), ["plan", "test", "pr"], "only valid JSONL events appended, in order");
    assert.equal(rec.prNumber, 7, "pr_number captured for P3/B4 routing");
    const called = sink.calledWith as { githubToken: string; argv: string[]; cloneDir: string };
    assert.equal(called.githubToken, "ghtok_secret", "the user's token is injected into the sandbox");
    assert.equal(called.cloneDir, SANDBOX_CLONE_DIR);
    assert.ok(called.argv.includes("--slug") && called.argv.includes("eri-labs/eri"), "slug passed to eri code-job");
    assert.equal(sink.tornDown, true, "sandbox stream consumed to completion (torn down)");
  }

  // ── runCodeJob fail-safe: no token → halted, never leaves the job running ─────
  {
    const store = memStore();
    await store.create({ jobId: "job_2", userId: "u1", repo: "eri-labs/eri", task: "x" });
    let sandboxRan = false;
    const deps: WorkerDeps = {
      store,
      githubToken: async () => null,
      runSandbox: () => { sandboxRan = true; return (async function* () {})(); },
    };
    const outcome = await runCodeJob({ jobId: "job_2", userId: "u1", repo: "eri-labs/eri", task: "x" }, deps);
    assert.equal(outcome?.kind, "halted");
    assert.equal(store.jobs.get("job_2")!.phase, "settled", "settled, not stuck running");
    assert.equal(sandboxRan, false, "no sandbox spun without a token (no cross-user reach)");
  }

  // ── runCodeJob: a stream that ends with no terminal line → halted (not stuck) ─
  {
    const store = memStore();
    await store.create({ jobId: "job_3", userId: "u1", repo: "r/x", task: "x" });
    const outcome = await runCodeJob({ jobId: "job_3", userId: "u1", repo: "r/x", task: "x" }, {
      store, githubToken: async () => "t",
      runSandbox: scriptedSandbox(['{"stage":"plan","text":"started"}']),
    });
    assert.equal(outcome?.kind, "halted");
    assert.equal(store.jobs.get("job_3")!.phase, "settled");
  }

  // ── makeCodeJobClient: start creates a row + kicks the worker; fetchRecord polls ─
  {
    const store = memStore();
    const kicks: unknown[] = [];
    let n = 0;
    const deps: CodeClientDeps = { store, mintJobId: () => `job_${++n}`, kick: async (i) => { kicks.push(i); } };
    const client = makeCodeJobClient(deps);
    const { jobId } = await client.start({ userId: "u1", task: "fix it", repo: "eri-labs/eri" });
    assert.equal(jobId, "job_1");
    assert.ok(store.jobs.has("job_1"), "a running job row is created at kickoff");
    assert.equal((kicks[0] as { repo: string }).repo, "eri-labs/eri", "the worker is kicked with the resolved repo");
    const rec = await client.fetchRecord("job_1");
    assert.equal(rec.jobId, "job_1");
  }

  // ── client.comment (P3/B4): routes back to the SAME job as an --update-pr follow-up ─
  {
    const store = memStore();
    await store.create({ jobId: "job_9", userId: "u1", repo: "eri-labs/eri", task: "orig" });
    await store.setPrNumber("job_9", 42);
    const kicks: Array<{ jobId: string; task: string; updatePr?: { number: number; url: string } | null }> = [];
    const deps: CodeClientDeps = { store, mintJobId: () => "nope", kick: async (i) => { kicks.push(i as never); } };
    const client = makeCodeJobClient(deps);
    await client.comment({ jobId: "job_9", comment: "rename to settleCart, re-run" });
    assert.equal(kicks[0].jobId, "job_9", "same job id, not a new job");
    assert.equal(kicks[0].task, "rename to settleCart, re-run");
    assert.equal(kicks[0].updatePr?.number, 42, "follow-up targets the existing PR");
    assert.ok(kicks[0].updatePr?.url.includes("eri-labs/eri/pull/42"), "PR url derived from repo + number");
  }

  // ── kill-switch: OFF by default (a new risky feature), on only when explicit ──
  {
    assert.equal(codeJobEnabled({}), false, "default OFF (shadow mode)");
    assert.equal(codeJobEnabled({ ERI_CODEJOB_ENABLED: "false" }), false);
    assert.equal(codeJobEnabled({ ERI_CODEJOB_ENABLED: "true" }), true, "explicit on, no allowlist → all users");
    assert.equal(codeJobEnabled({ ERI_CODEJOB_ENABLED: "true", ERI_CODEJOB_ALLOWLIST: "u1,u2" }, "u1"), true);
    assert.equal(codeJobEnabled({ ERI_CODEJOB_ENABLED: "true", ERI_CODEJOB_ALLOWLIST: "u1,u2" }, "u9"), false, "allowlist gates");
    assert.equal(codeJobEnabled({ ERI_CODEJOB_ENABLED: "true", ERI_CODEJOB_ALLOWLIST: "u1" }), false, "allowlist set but no userId → off");
  }

  // eslint-disable-next-line no-console
  console.log("coding-worker.test.ts: all assertions passed");
}

run();
