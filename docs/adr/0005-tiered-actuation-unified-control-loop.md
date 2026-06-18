# ADR-0005: Tiered actuation in one unified control loop (extends ADR-0002/0004)

- Status: Accepted
- Date: 2026-06-18
- Context: the "eri does everything" direction ([[project_eri_computer_control]]); builds on ADR-0002 (phone-eri transport + remote control) and ADR-0004 (hosted brain). Plan: `~/.claude/plans/fancy-snuggling-robin.md`.

## Context

eri's autonomous control loop (`crates/eri_cli/src/control_agent.rs`, `drive_control_loop`)
could originally only drive the **screen** — accessibility clicks + synthesized
keystrokes. Two problems followed:

1. **Brittleness.** Clicking/typing into apps is fragile (a "new TextEdit document"
   opened an Open panel; typing mashes onto whatever's focused). Many tasks have a
   faster, exact path the loop couldn't reach.
2. **It couldn't do real workflows.** "Reply to this email," "grab the chart from
   thread A and paste it into thread B," "open a PR" — these need an **API**, the
   **clipboard**, and sometimes a **screenshot**, interleaved in one run. The loop
   had none of that, and the connector (Composio) tools lived only in the *build*
   loop.

## Decision

**One unified control loop that picks the cheapest reliable tier per step**, rather
than a screen-only actuator or separate loops per surface. The loop is engine- and
tier-agnostic; tiers plug in behind small seams.

### The tiers (cheapest/most-reliable first)

| Tier | Mechanism | Used for | Seam |
|---|---|---|---|
| 0 — API | Composio Tool Router meta-tools (MCP) | anything with an API; **runs server-side, works with the computer OFF** | `McpDispatch` + `LiveMcp` (reuses build loop's `load_mcp`/`call_mcp_tool`) |
| 1 — AppleScript | `NSAppleScript` via the control server | semantic native-app control (new doc, compose mail, set a field) | `ControlAction::RunAppleScript` → `bridge.run_applescript` |
| 2 — Shell | (build loop today) | dev/file tasks | — |
| 3 — Computer-use | AX press + CGEvent + ScreenCaptureKit | apps with no API/script; visual glue | the existing `ControlBridge` primitives |

The **clipboard** (`ReadClipboard`/`WriteClipboard`) + **region capture**
(`capture_region`) are the cross-tier bus: they let one run carry content the API
can't reach across apps (screenshot a chart → clipboard → paste into a reply).

### Perception is automatic (the loop never acts blind)

In autonomous mode (default), after every action the loop feeds eri a fresh
accessibility snapshot before its next move — screenshot → act → re-perceive →
repeat. `look`/`capture_region` escalate to real pixels when the AX text is thin.

### Cloud vs local (Phase 5)

Whether a goal can run **with the computer off** is a property of *which tier it
needs*: API/Tier-0 work runs server-side (the phone/cloud path, same connectors +
memory + persona); screen/Tier-3 work needs the local machine. `classify_reach(goal)
-> {Api, Local, Mixed}` is the heuristic seam the router/cloud path consults;
unknown defaults to `Local` (never promise computer-off work we can't guarantee).
**Identity is tier-agnostic:** the persona + the user's memory are assembled once
and handed to whichever engine/surface runs — the user always talks to *eri*.

## Safety (one gate, all tiers)

Every mutating action — click, type, **AppleScript, shell, and connector API
sends** — passes through `ControlGate`: sensitive-action refusal
(passwords/money/CAPTCHA/access-control), stop-words, confirm-risky, learned
caution, and the undo/history log. AppleScript is content-gated like `Type`
(destructive scripts confirm; secret-bearing scripts refuse). Connector calls are
gated by an outward/mutating heuristic that scans the tool **name and payload**
(the Tool Router carries the real action slug, e.g. `GMAIL_SEND_EMAIL`, inside
`MULTI_EXECUTE` args), so an unattended "send" can't fire silently; reads pass.

## Consequences

- **eri is always-on for API work** — the headline win: API-able requests work with
  the laptop closed, computer-use only when the UI is genuinely required.
- The control loop and build loop now share the connector machinery (`load_mcp` /
  `mcp_tool_specs` / `call_mcp_tool` are `pub(crate)`), with the API tier behind the
  `McpDispatch` seam so the loop never depends on `eri_mcp` types directly.
- Output is a clean status protocol (`[eri-status]` chips + a single `[eri-result]`),
  never the raw chain-of-thought (`control_turn` no longer streams reasoning to
  stdout outside `ERI_DEBUG`).
- Token-frugal: the API tier is the ~6-tool Tool Router session, not 61+ flat
  schemas (see ADR-0004 / `composio_session.rs`); per-turn tool cost stays flat as
  more apps connect.

## Alternatives rejected

- **Screen-only control + a separate API agent.** A single workflow that interleaves
  API + screen + clipboard couldn't run in one loop without an orchestrator; the
  unified loop is simpler and matches how real tasks mix surfaces.
- **Route API goals to the build loop.** Keeps the control loop UI-only but splits a
  single user intent across two loops; rejected for the same reason.

## Status of the seams (as built)

`drive_control_loop` / `execute_tool_calls` take `autonomous: bool` + `mcp:
Option<&dyn McpDispatch>`; `run_control_agent` loads connectors, injects their
specs, and passes the live adapter. `classify_reach` is wired as an `ERI_DEBUG`
diagnostic today; promoting it to drive actual server-side dispatch is future work.
