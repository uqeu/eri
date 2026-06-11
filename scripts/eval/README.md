# eri eval harness

A small, growing set of fixed tasks scored pass/fail so we can prove eri's
agents got *better* (or catch a regression) instead of guessing. Inspired by
SWE-bench-style harnesses, but scoped to eri's wedge and kept cheap.

## Tier 0 — control routing (free, offline, deterministic)

The control router (cancellation → feasibility gate → fast lane) is
deterministic and spends **zero tokens**, so its eval runs in CI for free.

```bash
cargo test -p eri_cli control_routing_eval -- --nocapture
```

Prints a scorecard (`N/M passed`) and fails on any regression. The cases live in
`crates/eri_cli/src/control_agent.rs` (`control_routing_eval`): each is a goal +
its expected route (`fast` / `declined` / `cancelled` / `reasoning`). Add a case
by appending one line. This is the one to grow first — it's the wedge, and it's
free.

## Tier 1 — agentic build/control eval (`--live`, spends eri credits)

Real build/control quality needs a model in the loop, so it can't run in CI for
free. The intended shape (not yet wired):

- `cases/build.jsonl` — `{ "prompt": "...", "expect": { "compiles": true, "contains": ["..."] } }`
- `cases/control.jsonl` — `{ "goal": "...", "expect_actions": ["open:Safari"] }` run against a **mock bridge** (no real actuation)
- a runner that requires `--live` + a signed-in bearer, runs each case through
  the real loop, and scores it.

Until then, the deterministic Tier-0 eval is the source of truth, and the
control loop's behavior is pinned by the unit tests in `control_agent.rs`.

## Why this matters for token frugality

The eval is how we *tune* the cheap paths empirically. Example: Mercury's input
budget was cut from ~56K to ~24K tokens (`brain.rs` `profile_for`) for a better
quality/token ratio on diffusion edits — the build eval is how we'd confirm that
tighter budget didn't cost edit quality before tightening further.
