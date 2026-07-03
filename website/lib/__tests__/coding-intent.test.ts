import { strict as assert } from "node:assert";
import { classifyCodingIntent, type CodingIntent } from "../coding/intent";

/** Assert a message is classified as a coding task and return the intent. */
function coding(text: string): CodingIntent {
  const intent = classifyCodingIntent(text);
  assert.ok(intent, `expected coding intent for: ${JSON.stringify(text)}`);
  assert.ok(
    intent.confidence > 0 && intent.confidence <= 1,
    `confidence in (0,1] for: ${JSON.stringify(text)} (got ${intent.confidence})`,
  );
  assert.equal(intent.task, text.trim(), "task carries the trimmed message");
  return intent;
}

/** Assert a message is NOT a coding task (→ normal chat). */
function chat(text: string): void {
  assert.equal(
    classifyCodingIntent(text),
    null,
    `expected normal chat (null) for: ${JSON.stringify(text)}`,
  );
}

async function run() {
  // ── Coding tasks: a code-domain signal + an action (the wedge examples) ──────
  {
    // The demo target: failing test + repo + "fix it".
    const it = coding("the checkout test is failing on main in eri, fix it.");
    assert.equal(it.verb, "fix");
    assert.equal(it.repo, "eri");
  }
  {
    const it = coding("add a dark mode toggle to the settings component");
    assert.equal(it.verb, "add");
  }
  {
    // "open a PR" is a standalone coding signal — no other domain cue needed.
    const it = coding("open a PR that bumps the node version");
    assert.equal(it.verb, "open_pr");
  }
  {
    const it = coding("fix the null-cart bug in owner/repo");
    assert.equal(it.verb, "fix");
    assert.equal(it.repo, "owner/repo", "extracts an owner/repo slug");
  }
  {
    const it = coding("refactor the auth module to use async/await");
    assert.equal(it.verb, "refactor");
  }
  {
    const it = coding("the build is broken on CI, can you fix it");
    assert.equal(it.verb, "fix");
  }
  {
    const it = coding("write a unit test for the parser function");
    assert.equal(it.verb, "test");
  }
  coding("implement a /health endpoint in the api");
  coding("debug why the typescript compile is failing");
  coding("bump the eslint dependency to v9 and open a pull request");
  {
    // A github PR URL → repo hint from the URL, review verb.
    const it = coding("review this PR github.com/khai/eri/pull/12 and address the comments");
    assert.equal(it.repo, "khai/eri", "extracts owner/repo from a github URL");
  }

  // ── Repo hints via the "<name> repo" / "repo <name>" forms ───────────────────
  assert.equal(classifyCodingIntent("fix the failing test in the eri repo")?.repo, "eri");
  assert.equal(classifyCodingIntent("add a retry to the fetch helper in repo eri")?.repo, "eri");

  // ── Not coding: an action verb WITHOUT a code-domain signal stays chat ───────
  chat("fix my dinner reservation for 8pm");
  chat("add milk and eggs to my grocery list");
  chat("review my calendar for tomorrow");
  chat("how do I fix a leaky faucet");
  chat("build me a workout plan");
  chat("update my address to 123 Main St");
  chat("remind me to call mom");

  // ── Not coding: questions / chatter / confirmations (no action verb) ─────────
  chat("what was I working on?");
  chat("what's the weather in Toronto");
  chat("yes");
  chat("no");
  chat("");
  chat("   ");

  // ── Verb mapping spot-checks ─────────────────────────────────────────────────
  assert.equal(classifyCodingIntent("make a pull request to fix the lint errors")?.verb, "open_pr");
  assert.equal(classifyCodingIntent("debug the null pointer in the payment module")?.verb, "fix");
  assert.equal(classifyCodingIntent("rename the helper function in the codebase")?.verb, "refactor");
  assert.equal(classifyCodingIntent("implement pagination for the users endpoint")?.verb, "add");

  // No repo mentioned → repo is null (P4 connect-flow decides later).
  assert.equal(classifyCodingIntent("fix the failing unit tests")?.repo, null);

  // Stronger signals carry higher confidence than a bare verb+domain.
  {
    const strong = coding("open a PR to fix the failing test in khai/eri");
    const weak = coding("fix the failing tests");
    assert.ok(strong.confidence >= weak.confidence, "PR + repo slug outranks bare verb+domain");
  }

  // eslint-disable-next-line no-console
  console.log("coding-intent.test.ts: all assertions passed");
}

run();
