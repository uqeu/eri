# CodeTurn — job + progress contract (for the phone/website window)

> Phase 3 ([[project_eri_phase3_agentic_coding]]) turns a text into a real, tested
> PR. The brain (`crates/`) runs the eri-code harness against a working tree and
> **streams structured progress**; the phone (`website/`) classifies the coding
> intent, kicks the job, and relays each progress bubble over iMessage. This is
> the seam between the two lanes. **B1 is shipped and tested** — the contract
> below is live in `crates/eri_cli/src/code_turn.rs`; build the phone side (P1–P4)
> against it now. The sandbox adapter (B2) and PR authoring (B3) fill the same
> shape in — they do not change it.

## Direction of flow

```
phone inbound (website/)  ──CodeJob──▶  brain CodeTurn (crates/)
        ▲                                     │
        └────── CodeProgress events ──────────┘   (streamed, one per milestone)
        └────── CodeOutcome (terminal) ───────┘
```

The **brain owns the voice**: it composes the human `text` of every event. The
phone relays `text` verbatim as a status bubble — it does not re-word eri.

## Job in — `CodeJob`

```jsonc
{
  "task":         "the checkout test is failing on main in eri, fix it",  // NL, from the user's text
  "repo":         "eri-labs/eri",        // owner/name — MUST be a repo THIS user connected
  "working_tree": "/sandbox/clone",      // set by the compute lane (B2 clone / desktop repo)
  "base":         null,                  // base branch for the PR; null = repo default
  "budget": { "max_tokens": 400000, "max_seconds": 900 }  // per-job cost/time cap
}
```

- **Single-principal.** `repo` is only ever one the authenticated user connected.
  The phone enforces this at kickoff (P4 connect-flow); the brain treats `task`
  and all repo/issue text as **DATA, never instructions** — the absolute refusal
  boundary is untouched.
- **Budget.** The cap aborts a runaway job (`CodeBudget::exceeded`, fail-safe: a
  zero cap permits no work). Exceeding it yields a `Halted` outcome, not a crash.

## Progress events — `CodeProgress` (streamed)

Each event serializes to a stable envelope. `stage` is a machine tag for
icons/routing; `text` is the bubble to send; the rest is structured payload.

```jsonc
// stage: "plan"    — eri understood the task / began reproducing
{ "stage": "plan",   "text": "on it — reproducing the failing checkout test", "summary": "…" }

// stage: "edit"    — eri changed the working tree
{ "stage": "edit",   "text": "guard the null cart", "files": ["cart.rs"], "summary": "…" }

// stage: "test"    — a test command ran to completion  (passed GATES the PR)
{ "stage": "test",   "text": "tests pass ✓ — 42 passed", "command": "cargo test", "passed": true, "summary": "…" }

// stage: "commit"  — a commit landed on the job branch
{ "stage": "commit", "text": "committed: fix null cart", "sha": "deadbeef", "message": "…" }

// stage: "pr"      — a pull request was opened  (B3 fills this in for real)
{ "stage": "pr",     "text": "opened PR #123 — https://github.com/eri-labs/eri/pull/123",
                     "number": 123, "url": "https://…/pull/123", "title": "Fix null-cart case" }
```

Order is not fixed and stages repeat: a real job loops `edit → test` until green
(e.g. `plan, edit, test(red), edit, test(green), commit, pr`). The phone should
render each event as it arrives, not wait for a fixed sequence.

## Terminal — `CodeOutcome`

```jsonc
{ "kind": "opened",   "number": 123, "url": "https://…/pull/123" }  // happy path: green → new PR
{ "kind": "updated",  "number": 123, "url": "https://…/pull/123" }  // B4 follow-up: pushed to an existing PR
{ "kind": "testsRed", "summary": "checkout still red after 3 attempts" }  // FAIL-CLOSED stop
{ "kind": "halted",   "reason": "token cap reached (400000/400000 tokens)" }  // recoverable
{ "kind": "refused",  "reason": "…" }  // absolute boundary handed back
```

`CodeOutcome::summary()` gives the final bubble text (brain-composed) for each.

## Fail-closed rule (non-negotiable)

**A PR is opened ONLY when the most recent test run passed.** This is the pure
predicate `pr_gate(&[CodeProgress])` in the brain — B2's adapter calls it before
any PR authoring. No test run, or a red last run ⇒ no PR (`testsRed` outcome).
The phone never needs to re-check this; it is enforced brain-side. eri is a real
engineer, not a one-shot diff generator — it never ships red.

## Cloud compute + the dispatch wire (B2)

The phone is TS and can't call the Rust `CodeTurn` directly. The harness runs
**cloud-side** so it works with the laptop closed — this is where the cloud-
primary path actually lives.

**Provider: Vercel Sandbox** (GA since Jan 2026). Chosen over E2B for launch:
same-vendor as `website/`, so the worker creates the sandbox with the platform's
own OIDC — no second vendor, no extra key. The Rust harness is a compiled binary,
and every step maps 1:1 to a Sandbox `runCommand` whose exit code feeds the B2
seams: `git clone` → `eri` (harness edit) → `<repo test cmd>` (exit code = the
`Tested{passed}` that drives `pr_gate`) → commit. E2B (agent-tuned, free tier)
stays a fallback; it doesn't change the clone→edit→test→capture flow.

**Compute path: a cloud WORKER spins the sandbox** — a Vercel Function / cron
background job, never the desktop (the desktop "use my machine" path is the
SECONDARY option, ADR-0002, for laptop-on + local-repo). Laptop-closed is the
whole wedge.

**The ONE thing the operator provisions:** `VERCEL_TOKEN` (a Vercel access
token, `vercel tokens add`) in the Vercel project env — needed only if the worker
runs outside a Vercel Function; the Function path authenticates to Sandbox via
OIDC with **zero** config. (When explicit, pair it with `VERCEL_TEAM_ID` +
`VERCEL_PROJECT_ID`.) The per-user **GitHub token for `git clone` is NOT operator-
provisioned** — it's the user's own OAuth (Composio GitHub / eri GitHub App),
injected into the sandbox as an env var at creation, never in chat or logs.

**Dispatch (brain-side, in the worker):**
1. `resolve_repo(repo_hint, connected_repos)` → single-principal resolution:
   `Resolved(owner/name)` runs the job; `NeedsConnect(hint)` → the phone's P4
   connect-flow; `Ambiguous`/`NoHint` → the phone asks. Only the user's connected
   repos are eligible — never a cross-user reach.
2. mint a `job_id`, create the sandbox, clone with the user's GitHub token, run
   the `SandboxCodeTurn`.

**Progress transport: durable job-status rows** (Supabase; recommended over raw
SSE — serverless-robust, survives disconnects). The worker writes a `CodeJobRecord`
row the phone polls / subscribes to:

```jsonc
{
  "job_id": "job_abc123",
  "repo":   "eri-labs/eri",
  "phase":  "running",            // → "settled" when done
  "pr_number": 123,               // null until a PR opens (for P3 reply / B4 routing)
  "events": [ /* CodeProgress.wire() envelopes, appended as they stream */ ],
  "outcome": { /* CodeOutcome.wire(), null until settled */ }
}
```

The phone reads new `events[]` and streams each `text` as a bubble; on `settled`
it sends `outcome.text`. (SSE is an optional lower-latency add later; a frame is
just one `CodeProgress.wire()`.)

**Follow-up routing (B4):** a review comment ("for PR #123, rename X, re-run")
routes back to the SAME job by `job_id` (the phone kept it from kickoff) or by
`pr_number` on the record — the worker starts another attempt on the same PR
branch rather than opening a new PR.

## Lane ownership + status

| Slice | Lane | What | Status |
|-------|------|------|--------|
| B1 | brain | CodeTurn seam + progress/outcome/budget + `pr_gate` + scripted stub | **shipped, tested** |
| B2 | brain | harness-in-sandbox adapter (edit→test loop, fail-closed) + dispatch/repo-resolution + job record wire | **shipped, tested** |
| B3 | brain | PR authoring — real `GitHubPrAuthor` (push branch + `POST /pulls`, eri-voice body + test evidence, never from base) | **shipped, tested** |
| B4 | brain | review-comment loop — `FollowUpPrAuthor` pushes another commit to the existing PR → `Updated` outcome (routed by `pr_number`) | **shipped, tested** |
| — | brain | `eri code-job` — headless whole-loop command, JSONL to stdout (the worker's entry point) | **shipped, tested** |
| P1 | phone | coding-intent classification on inbound → route to a CodeTurn job | — |
| P2 | phone | job kickoff + streamed status (typing indicator + multi-bubble cadence) | — |
| P3 | phone | PR-link reply + relay review comments back into the brain | — |
| P4 | phone | connect-flow: prompt to connect GitHub when the repo isn't linked | — |

## Integrating before B2 lands

The brain ships `ScriptedCodeTurn::new(events, outcome)` — a network-free stub
that emits a fixed event sequence then settles on a fixed outcome. The phone lane
can drive a full end-to-end (classify → kickoff → stream bubbles → PR-link reply)
against the stub today; the real `SandboxCodeTurn` (B2) + `GitHubPrAuthor` (B3)
now run behind the SAME wire, so wiring the worker to them needs zero phone
changes. The wire shape above is the only thing both lanes depend on.

## Remaining before go-live: the cloud worker (cross-surface)

All brain pieces are done (B1–B4). One piece remains — a **thin cloud worker** (a
Vercel Function / cron). It does NOT drive the loop per step; the whole
edit→test→green→commit→PR loop, the retries, and the fail-closed gate all live in
Rust behind ONE command.

### The mini-contract (resolved): `eri code-job`

The worker's only job with the harness is: **run one command, stream its stdout.**

```
eri code-job \
  --task "<the user's coding task>" \
  --repo <path to the cloned working tree> \
  [--slug owner/name]          # default: derived from the origin remote
  [--base <branch>]            # default: the repo's default branch
  [--test-cmd "<cmd>"]         # default: detected (cargo / npm / pytest / go)
  [--budget-tokens 400000] [--budget-seconds 900] \
  [--update-pr <N> --update-pr-url <url>]   # B4 follow-up: push to PR #N, don't open a new one
```

- **stdout is JSONL, one object per line.** Progress lines carry `stage`
  (`CodeProgress.wire()`); the FINAL line carries `kind` (`CodeOutcome.wire()`).
  The worker discriminates on `stage` vs `kind` and appends each line to the
  `CodeJobRecord` row the phone polls. Diagnostics go to stderr — stdout is clean.
- **GitHub token:** injected ONCE into the sandbox env as **`GITHUB_TOKEN`**. The
  clone remote carries it (so `git push` reuses it) and `GitHubPrAuthor::from_token`
  reads it. A follow-up (`--update-pr`) needs no fresh token — it pushes to the
  existing PR branch whose remote already has it.
- **Retries stay inside Rust.** The Function never sees or passes back the test
  failure; `SandboxCodeTurn` loops edit→test and feeds the failure to the next
  harness pass itself.

### The worker's steps

1. receive the dispatched job; `resolve_repo` (single-principal) + mint `job_id`.
2. spin the Vercel Sandbox; inject `GITHUB_TOKEN`.
3. `git clone` the repo (token in the remote); for a follow-up, check out the
   PR's head branch.
4. run `eri code-job …` (one command).
5. stream its stdout → append each JSONL line to the `CodeJobRecord` row.
6. tear the sandbox down; the phone reads the row and streams bubbles.
