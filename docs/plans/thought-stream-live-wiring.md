# Thought-stream terminal — wiring it to the real agent

**Status:** handoff spec. The *look* is built and shipped (marketing site); the
*live data* is not. This doc is for whoever wires the real eri agent loop to it.

**TL;DR:** The terminal UI is trivial and already exists. It renders a list of
four line kinds and reveals them one at a time. To make it real, the agent loop
must **emit** one of those lines per step, and we **transport** those lines to
the UI. The renderer does not change — only its data source.

---

## 1. The data contract (the whole thing)

Every line eri "shows" is one of four kinds:

```ts
type LineKind = "think" | "cmd" | "out" | "done";
interface Line { k: LineKind; t: string; }
```

| kind    | meaning                          | style (terminal)          |
| ------- | -------------------------------- | ------------------------- |
| `think` | a reasoning / status note        | italic gray               |
| `cmd`   | a command / tool it's running    | lime, prefixed `$`        |
| `out`   | a result line (summarized)       | gray, prefixed `•`        |
| `done`  | the turn finished                | green, prefixed `✓`       |

That's the entire interface between the agent and the UI. Get the agent to emit
`Line`s and you're done.

---

## 2. The renderer (UI) — already exists, reuse as-is

The canonical implementation is `TerminalStream` in
`website/components/home/CapabilityGrid.tsx`, styled by the `.cterm__*` classes
in `website/app/globals.css` (`.cterm__think/cmd/out/done`, `.cterm__prompt`
`$`, `.cterm__bullet` `•`, `.cterm__check` `✓`, `.cterm__caret` blink).

The "streaming" is just a counter of how many lines are visible. For canned
content it's a timer; **for live content, append as events arrive:**

```tsx
// Live version: push each incoming line into state, render all of them.
const [lines, setLines] = useState<Line[]>([]);
// onStreamLine(line) => setLines(prev => [...prev, line]);

const done = lines.at(-1)?.k === "done";
return (
  <div className="cterm__body">
    {lines.map((l, i) => (
      <div key={i} className={`cterm__line cterm__${l.k}`}>
        {l.k === "cmd"  && <span className="cterm__prompt">$</span>}
        {l.k === "out"  && <span className="cterm__bullet">•</span>}
        {l.k === "done" && <span className="cterm__check">✓</span>}
        <span>{l.t}</span>
      </div>
    ))}
    <span className={`cterm__caret${done ? " cterm__caret--idle" : ""}`} aria-hidden />
  </div>
);
```

Reduced motion: render lines on arrival, skip any reveal delay. New turn:
clear `lines` on the first `think`/`cmd` after a `done`.

---

## 3. The live wiring (the actual work)

Three steps: **emit → transport → render.**

### 3a. Emit — from the agent loop

The loop already goes through these phases; tag each one and push a `Line`.

| Agent loop event                                   | emit                                                  |
| -------------------------------------------------- | ----------------------------------------------------- |
| model reasoning / a status note                    | `{k:"think", t:"reading 42 unread…"}`                 |
| a tool/command invocation (tool name + key args)   | `{k:"cmd",   t:"eri gmail triage --inbox"}`           |
| a tool result (summarize to **one** line)          | `{k:"out",   t:"38 archived · 4 need you"}`           |
| the turn completed                                 | `{k:"done",  t:"inbox at zero"}`                       |

Where to put the emit in this repo (verify exact symbols, they move):

- **Rust agent/control loop** — `crates/eri_cli/src/control_turn.rs` already has a
  `ControlTurnSink` instrumentation seam that sees every step; that is the
  natural emit point. The build/coding loops (`agent.rs`, `coding_agent.rs`,
  `coding_control.rs`, `drive_control_loop`) have the same shape. The trust layer
  (`action_log.rs`) already logs actions — model the line emit alongside it.
- Render a `cmd` from a tool call by formatting `tool_name` + its salient args as
  a CLI-looking string (`eri <verb> <args>`). It's a label, not a real shell.

### 3b. Transport — to the UI

Reuse the channel that already streams the CLI to the surfaces:

- **Agent Manager** (`apps/eri-agent-manager`) — the WKWebView bridge is already
  wired to the live eri CLI stream. Add a `stream_line` event to that stream
  (newline-delimited JSON on stdout, or the existing webview `postMessage`
  bridge) and have the webview JS push it into the renderer's `lines` state.
- **IDE panel** (`ide/extensions/eri-ai-panel`) — same events over the same
  extension messaging.

Minimal protocol (one JSON object per line, append-only):

```json
{"type":"stream_line","turn":"<turn-id>","kind":"think|cmd|out|done","text":"...","app":"Gmail","ts":1234567890}
```

`turn` lets the UI group lines and reset on a new turn. `app` is optional (drives
the title-bar icon/label). Keep it append-only and idempotent.

### 3c. Render

Keep the `.cterm__*` markup + CSS. Swap the data source from the timer-walked
array to the incoming `stream_line` events (section 2). Done.

---

## 4. Quality bar (don't make it lie)

The terminal is a trust surface — it claims eri did real things. So:

- Only emit `done` when the turn **actually** completed.
- `out` lines summarize **real** tool results — never invent counts/names.
- If a step errors, emit it honestly (an `out` line, or add an `err` kind) rather
  than a fake `done`.
- The marketing/dashboard versions are intentionally canned and **labeled as a
  preview**; the live one must not be mistaken for a preview, and vice versa.

---

## 5. Checklist for the app Claude

- [ ] Emit `Line`s (4 kinds) from the agent loop at the `ControlTurnSink` seam.
- [ ] Map tool calls → `cmd` (formatted), tool results → `out` (one summarized line).
- [ ] Add the `stream_line` event to the Agent Manager CLI stream + IDE messaging.
- [ ] Renderer: append events into `lines` state, reuse `.cterm__*` styling.
- [ ] Reset on new turn; honest `done`; reduced-motion path.
- [ ] Verify with a real task end-to-end (e.g. a Gmail triage) — no canned data.

**Reference look:** `website/components/home/CapabilityGrid.tsx` (`TerminalStream`)
+ the `.cterm__*` classes in `website/app/globals.css`.
