# Terminal Organization — Competitive Landscape

Independent survey of what the field already ships for terminal organization,
arrangement, multiplexing, and block-style history. Written to triangulate
where eri's in-house terminal module needs to match the state of the art, where
it can leapfrog, and where it should explicitly skip work. All claims are
pattern-level; no code from any third-party project was read or copied.

---

## 1. Warp

Warp is the modern reference design for what a terminal can be once it is
treated as an application surface rather than a glass TTY. It is closed source
but its public docs and engineering blog describe the architecture in enough
detail to study without touching code.

**Block-based history model.** Every command and its output form an addressable
unit Warp calls a "block." Blocks have a stable id, exit status, timing, and
support copy / share / rerun directly from the UI. Scrollback is no longer a
linear text buffer — it is an ordered list of structured records the user can
fold, search, and pin. The cursor moves between blocks rather than between
lines. [source: docs.warp.dev/features/blocks]

**Warp AI.** Inline natural-language to shell command translation, error
explanation on non-zero exit, and a chat sidebar that has read access to the
current block's output. Warp AI 2.0 ("Warp Agent Mode") drives a multi-step
agent that can edit files and run commands with user approval. The pattern that
matters: AI gets first-class access to *structured* terminal state because the
blocks already exist as records. [source: warp.dev/blog/launching-warp-agent-mode]

**Notebooks.** Saved sequences of commands interleaved with markdown notes,
shareable across a team. Closer in spirit to a runbook than to Jupyter — there
is no kernel, just ordered runnable cells. [source: docs.warp.dev/features/warp-drive/notebooks]

**Workflows.** Parameterized command templates with description and
argument metadata. Surfaces in the command palette as a fuzzy-findable library.
Shipped with a YAML schema in the open-source `warpdotdev/workflows` repo
(Apache 2.0), which is the only Warp asset eri could actually reuse.
[source: github.com/warpdotdev/workflows]

**Teams / shared sessions.** Warp Drive is a cloud-synced workspace of
notebooks, workflows, environment variables, and saved prompts shared across a
team. Live session sharing is a real-time pair-on-a-terminal feature, separate
from Drive. [source: docs.warp.dev/features/warp-drive]

**Pricing.** Free for individuals with usage caps on AI requests. Pro at
roughly USD 15 per user per month, Team at roughly USD 22, Enterprise on quote
as of 2026. [source: warp.dev/pricing]

**Open-source equivalents.** Wave Terminal (Apache 2.0) is the most direct
free analogue for block-style history. WezTerm and Ghostty add modern rendering
but stop short of block semantics. None ship Notebooks/Workflows/Drive parity.

---

## 2. iTerm2

The de-facto power-user terminal on macOS. GPLv2, which means eri cannot lift
code; the patterns are nevertheless instructive.

**Profiles.** A profile is a named bundle of terminal settings: shell, working
directory, color scheme, font, environment variables, startup command, badge
text. New tabs/windows can be spawned against a profile. The flat key/value
profile store is the design eri's saved-layout schema is closest to.
[source: iterm2.com/documentation-preferences-profiles-general.html]

**Window arrangements.** A named snapshot of every open window, tab, and split
pane, including starting commands and working directories. Restorable on demand
or on launch. This is the single iTerm feature eri's "saved layouts" most
directly mirrors. [source: iterm2.com/documentation-arrangements.html]

**Hotkey windows.** A profile flag that binds a global hotkey to a slide-down
quake-style terminal. Useful as a UX pattern for the "scratchpad terminal" eri
will likely want.

**Tmux integration.** Control mode (`tmux -CC`) where iTerm renders tmux
windows/panes as native iTerm windows/panes. The lesson: a frontend can
delegate session persistence entirely to tmux while still presenting a native
UI. [source: iterm2.com/documentation-tmux-integration.html]

**Triggers.** Regex rules over scrollback text that fire actions: highlight,
post notification, run a script, send keystrokes. Closest existing analogue to
what eri's voice/gaze targeting needs at the data layer — text → event → action.

**Shell integration.** Optional script (sourced from `~/.iterm2_shell_integration.zsh`
or equivalent) that emits OSC escape sequences marking prompt, command,
command-output, and exit-code regions. This is the *exact* primitive VS Code
later standardized for its own shell integration. [source: iterm2.com/documentation-shell-integration.html]

**What we can borrow vs not.** Patterns yes, code no. Arrangements as JSON,
triggers as a regex-action rules engine, shell-integration semantics, and
hotkey scratchpads are all idea-level. Any direct port of iTerm code would
contaminate eri's MIT/Apache license posture.

---

## 3. tmux

BSD-2-clause. The reference terminal multiplexer; the model every other tool
imitates or wraps.

**Sessions → windows → panes.** A session contains windows; each window
contains a tree of panes. Panes are pty processes; windows are layouts; the
session is the persistence unit. [source: man tmux(1)]

**Detach / attach.** The defining tmux trick: a session lives in the tmux
server process, independent of any client. Detaching closes the client but
keeps the session and its processes alive. Reattaching binds a new client to
the running session. This is what makes tmux survive SSH disconnects and
terminal restarts — the pty does not belong to the visible terminal.

**Custom keybindings.** Everything is a command in tmux's command language;
keybindings just bind keys to commands. The leader key (default `C-b`)
prevents collisions with shell shortcuts. Pattern worth noting: a uniform
command bus means scripting and keybinding share the same surface.

**Plugins.** TPM (Tmux Plugin Manager) is the conventional installer.
- **tmux-resurrect** — saves window/pane layout + working directories +
  optionally process lines to disk, restores on demand. [source: github.com/tmux-plugins/tmux-resurrect]
- **tmux-continuum** — automates resurrect on an interval, optionally on
  tmux server start. [source: github.com/tmux-plugins/tmux-continuum]
- **tmux-yank**, **tmux-pain-control**, **tmux-sessionist** — quality-of-life.

**Tmux as session manager pattern.** Many shops never use tmux's multiplexer
features and instead use it purely for session persistence: one named session
per project, attach on `cd`, detach on close. Tools like `tmuxinator`,
`tmuxp`, and `sesh` ship YAML/TOML/Lua project files that describe the layout
to spawn. eri's saved-layout JSON is one rung up on the abstraction ladder
from these. [source: github.com/tmuxinator/tmuxinator]

---

## 4. VS Code native terminal capabilities

The substrate eri is building on. MIT-licensed extension API; the rendering
surface itself is part of the editor and cannot be replaced from an
extension.

**vscode.window.createTerminal.** Accepts `name`, `cwd`, `shellPath`,
`shellArgs`, `env`, `location` (panel / editor area / split next-to), and an
optional `pty` for fully virtualized terminals (`Pseudoterminal` interface).
[source: code.visualstudio.com/api/references/vscode-api#window]

**TerminalShellIntegration.** Since 1.85, a per-terminal object exposing
`executeCommand`, `cwd`, and `onDidExecuteCommand`. The event carries the
command line, exit code, and a `read()` stream of output. This is the API
that makes Warp-style block capture possible inside a VS Code fork without
running a custom shell or PTY. [source: code.visualstudio.com/api/references/vscode-api#TerminalShellIntegration]

**TerminalShellExecution.** The per-command object yielded by shell
integration events. Exposes `commandLine`, `cwd`, and the async iterable
`read()`. Output arrives in chunks; consumer is responsible for buffering and
ANSI stripping. [source: code.visualstudio.com/api/references/vscode-api#TerminalShellExecution]

**Terminal location.** `TerminalEditorLocation` puts terminals in the editor
area like a file tab; `TerminalSplitLocation` opens next-to-another. The
classic panel is the default. Extensions cannot draw inside the terminal
rectangle but can place chrome around it via TreeView / webview panels.

**Terminal groups (split panes).** The terminals panel groups multiple
terminals horizontally; each group renders as a tabbed strip with an internal
splitter. The naming is confusing because "group" is overloaded — VS Code's
"group" is a single tab with multiple split panes. eri's "group" is a
user-visible folder of terminals. We disambiguate by always saying "split"
for VS Code's notion and "folder" for ours.

**TreeDragAndDropController.** Since 1.66, tree views can declare supported
MIME types, intercept drops, and emit drags carrying a custom payload.
Required for the "drag terminal between folders" UX. [source: code.visualstudio.com/api/references/vscode-api#TreeDragAndDropController]

**Terminal state events.** `onDidOpenTerminal`, `onDidCloseTerminal`,
`onDidChangeActiveTerminal`, `onDidChangeTerminalState` (focus / interaction
flags), `onDidChangeTerminalShellIntegration` (fires when integration becomes
available on a terminal, often after the first prompt). These collectively
allow a faithful projection of terminal state into a tree view.

**Limits.** Extensions cannot: restyle the terminal renderer, intercept
keystrokes inside an active terminal, replace the scrollback widget, or
customize the terminals panel chrome (tab bar, group splitter). eri is
shipping inside a VSCodium fork, which means we *can* edit those surfaces —
but doing so leaves the extension-API contract and ties us to fork
maintenance forever. The brief here is what stock VS Code allows; the fork
budget is decided separately.

---

## 5. Open-source VS Code extensions for terminal organization

Surveyed via OpenVSX and GitHub `topic:vscode-extension terminal` searches.
Star counts and last-commit dates are approximate as of May 2026.

| Extension | Author | License | ~Stars | Last commit | What it does | What it misses |
|---|---|---|---|---|---|---|
| Terminal Tabs | Tyriar | MIT | ~200 | 2024 | Tree view mirror of `window.terminals`; click to focus | No grouping, no persistence, no blocks |
| Terminals Manager | fabiospampinato | MIT | ~600 | 2025 | YAML-driven recipe runner: spawn N named terminals with cwd + commands | Recipe is one-shot, no grouping, no rename-on-command |
| Restore Terminals | EthanSK | MIT | ~250 | 2024 | Persists terminal definitions across window reload | No live tree, no folders, no blocks |
| Terminal Keeper | NotWearingPants | MIT | ~80 | 2024 | Reads `.vscode/terminal-keeper.json`, spawns on open | No UI, config-only |
| Tabs Outliner-style Terminal Manager (various forks) | — | MIT/Apache | varies | varies | Tree + collapse/expand of terminal sessions | UI parity at best, no AI surface |
| Multi Command | ryuta46 | MIT | ~600 | 2025 | Run sequences of VS Code commands; chained terminal sends | General-purpose, not terminal-specialized |
| Tasks Shell Input | augustocdias | MIT | ~80 | 2023 | Parameterize VS Code tasks with shell output | Adjacent, not organizer |
| Local Tmux | (multiple) | MIT | ~50 | 2023 | Wraps a tmux session inside a VS Code terminal | Pass-through, no native organization |
| Terminal Profile Switcher | (multiple) | MIT | ~30 | 2024 | Quick-pick over `terminal.integrated.profiles` | Profile UX only |
| Sticky Terminal | (various) | MIT | ~40 | 2023 | Pins a terminal to a workspace | Sub-feature, not full organizer |

Pattern across the board: tree mirror + JSON config + spawn-on-command. No
extension we found ships block capture, voice targeting, or layout snapshots
with re-spawn fidelity. The market gap eri is filling is real.

---

## 6. Open-source Warp alternatives

**Wave Terminal.** Apache 2.0. The closest spiritual port of Warp into open
source. Treats each command as a "widget" and supports inline AI, file
preview, and a graph of blocks. Built in Go + React with a custom renderer.
Cross-platform. Ships its own AI broker that talks to OpenAI/Anthropic/local
models. [source: github.com/wavetermdev/waveterm]

**WezTerm.** MIT. Rust-based, GPU-accelerated, Lua-configured. Excellent
rendering, multiplexer built in (`wezterm mux`), no block model. The lesson:
how to ship a fast cross-platform terminal that supports configuration as
code without becoming Emacs. [source: github.com/wez/wezterm]

**Ghostty.** MIT. Mitchell Hashimoto's terminal. Zig core, native
platform-specific UIs (AppKit on macOS, GTK on Linux). Focus: rendering
correctness and speed, minimal config. No blocks, no AI, intentionally
small surface area. The lesson: a terminal can be world-class by doing
*only* the terminal job well. [source: github.com/ghostty-org/ghostty]

**Bun terminal stuff.** Bun is a JavaScript runtime, not a terminal. It does
ship a TUI renderer in stdlib (`Bun.spawn` plus the new `Bun.Terminal` shim)
for building CLI apps, but there is no Bun-branded terminal emulator. Listed
here only to document the dead end. [source: bun.sh/docs]

**Other contenders.** Tabby (MIT) — Electron-based, tabbed, with SSH and
serial port support; no blocks. Hyper (MIT) — Electron, plugin-driven, less
actively maintained as of 2026. Alacritty (Apache 2.0) — minimalist GPU
terminal, no organization features.

---

## 7. Cross-cutting patterns

**Persistence across reload.** Three dominant approaches:
1. *Out-of-process pty server.* tmux, Wave, screen. The terminal client is
   stateless; the server owns the pty and survives client restarts. Highest
   fidelity, requires shipping a daemon.
2. *Serialize-and-respawn.* iTerm arrangements, tmux-resurrect,
   Restore Terminals. Save layout to disk, spawn fresh processes on reload.
   No process continuity, but no daemon either.
3. *Host-managed persistence.* VS Code's
   `terminal.integrated.persistentSessionReviveProcess` reattaches the
   editor's own pty host across reloads. eri inherits this for free.

**Shell integration portability.** OSC 133 and OSC 633 (VS Code's superset)
are the convergent standard. iTerm and Warp use OSC 133; VS Code adds OSC 633
to carry cwd and exit code in a single sequence. Shells that ship native
support: zsh (via plugins), bash (sourced script), fish (built-in since 3.6),
PowerShell (module). Nushell does not emit standard OSC 133 by default — it
requires a custom `PROMPT_COMMAND` snippet. Eri's fallback for nu is a
first-line-after-prompt heuristic.

**Exposing terminals to AI agents.** Warp's pattern is the canonical one:
blocks are records, AI gets read access to the most recent block's input +
output + exit code on demand, plus optional cwd and shell env. Cursor and
Continue follow the same idea via VS Code's shell-integration API. The
"block as structured record" is what makes AI-on-terminal not require
scraping. eri builds the same surface: every captured `TerminalShellExecution`
becomes a block record, exposed via the agent registry as a typed handle.

**Block as first-class object.** Warp, Wave, and to a lesser extent
WezTerm's "scrollback marks" all converge on this: command + output + exit
+ id + time form one unit, addressable from URL-like ids, copy/share/rerun
in one click. Even classic shells now do a degraded version via
`fc -l` history with the OSC 133 markers — `atuin` (MIT) is essentially a
block store decoupled from any specific terminal. [source: github.com/atuinsh/atuin]

**Where session state lives on disk.** Conventions vary:
- tmux: `/tmp/tmux-<uid>/default` socket; tmux-resurrect snapshots under
  `~/.tmux/resurrect/`.
- iTerm: `~/Library/Application Support/iTerm2/SavedArrangements/`.
- Warp: `~/.warp/` and a cloud Drive.
- VS Code: workspace state under `~/.config/Code/User/workspaceStorage/<hash>/`
  plus the global pty host store at `~/.config/Code/User/globalStorage/`.
- Eri convention: `.eri/terminal-layouts/*.json` per workspace,
  `globalState` for cross-workspace org structure, never cloud unless the
  user opts in.

---

## 8. What eri should match / beat / skip

A concrete row-per-decision view. "Match" means feature parity is the bar;
"beat" means eri ships a superset or a clearly better UX; "skip" means we
deliberately do not ship this.

| # | Feature | Source | Stance | Notes |
|---|---|---|---|---|
| 1 | Tree-view mirror of live terminals | VS Code, Terminal Tabs | Match | Read-only projection of `window.terminals` |
| 2 | Click tree item to focus terminal | Terminal Tabs | Match | `terminal.show()` |
| 3 | User-defined folders/groups of terminals | None of the OSS ext do this well | Beat | Drag-drop between folders |
| 4 | Drag-drop with TreeDragAndDropController | VS Code API | Match | Required for folder UX |
| 5 | Auto-name terminal after first command | Warp, Restore Terminals partial | Beat | Synonyms table for common scripts |
| 6 | Lock name after manual edit | None | Beat | Edit-once-locked invariant |
| 7 | Auto-group by cwd longest-prefix | None | Beat | Match new terminals to ancestor folder |
| 8 | Save layout to JSON | iTerm arrangements | Match | `.eri/terminal-layouts/<name>.json` |
| 9 | Restore layout: spawn terminals + cwd + command | iTerm, tmuxinator | Match | No pty migration |
| 10 | Per-layout startup command | iTerm | Match | Honor as `sendText` post-spawn |
| 11 | Layout includes folder structure | None | Beat | Save the org tree, not just terminals |
| 12 | Block capture per command | Warp, Wave | Match | Via `onDidExecuteCommand` |
| 13 | Block: id, exit code, duration, cwd | Warp | Match | All four are in `TerminalShellExecution` |
| 14 | Block list side panel | Warp | Beat | Side panel, not replacement renderer |
| 15 | Block copy / rerun actions | Warp | Match | Code action on block hover |
| 16 | Block share via gist/cloud | Warp Drive | Skip | Privacy posture; manual copy only |
| 17 | Hotkey scratchpad terminal | iTerm | Match | Global keybind to focus a designated terminal |
| 18 | Quake-style slide-down terminal | iTerm | Skip | Renderer change, outside VS Code surface |
| 19 | Triggers (regex → action) | iTerm | Beat | Triggers fire eri-events, not shell |
| 20 | Shell integration OSC 633 | VS Code | Match | Inherit from VS Code |
| 21 | Shell integration OSC 133 fallback | iTerm, Warp | Match | Same parser handles both |
| 22 | Nushell graceful degrade | Nobody supports nu well | Beat | First-line-after-prompt heuristic + UI banner |
| 23 | Fish, PowerShell, bash, zsh parity | Wave, Warp | Match | Test matrix |
| 24 | Tmux integration (control-mode style) | iTerm | Skip | Not a multiplexer frontend |
| 25 | Session detach/attach | tmux | Skip | VS Code already handles process survival |
| 26 | Warp Notebooks | Warp | Beat | "Runbooks" feature: markdown + runnable cells via VS Code notebook API |
| 27 | Warp Workflows (parameterized templates) | Warp | Match | Adopt warpdotdev/workflows YAML schema directly |
| 28 | Workflow command palette entry | Warp | Match | Quick-pick over workflow library |
| 29 | Team-shared workflows | Warp Drive | Skip | No cloud in v1 |
| 30 | Real-time pair on terminal | Warp | Skip | Out of scope; Live Share covers it |
| 31 | AI explain command output | Warp AI | Match | Eri agent reads last block on request |
| 32 | AI rewrite command | Warp AI | Match | Inline action on a block |
| 33 | AI agent runs commands with approval | Warp Agent Mode | Match | Through eri's tool-use surface |
| 34 | Voice-targeted terminal | Nobody | Beat | "Run dev server" → resolve to terminal by folder + name |
| 35 | Gaze-targeted terminal focus | Nobody | Beat | Focus follows gaze when in terminal-target mode |
| 36 | Profiles (color, font, env per terminal) | iTerm | Match | Map to VS Code `terminal.integrated.profiles` |
| 37 | Per-folder default profile | None | Beat | Folder owns a default profile name |
| 38 | Badge text on terminal | iTerm | Skip | VS Code shows name only; not worth a fork |
| 39 | Per-terminal env vars | iTerm, VS Code | Match | `createTerminal({ env })` |
| 40 | Per-terminal cwd | All | Match | `createTerminal({ cwd })` |
| 41 | Restore on window reload | VS Code default + Restore Terminals | Match | Inherit + persist org layer |
| 42 | Audit log of terminal events | None | Beat | `.eri/audit.log` JSONL |
| 43 | Block search across terminals | atuin, Warp | Match | In-memory index over captured blocks |
| 44 | Block export to file | Warp | Match | Right-click → save block |
| 45 | Bounded block storage | None document this | Beat | 200 in-mem / 50 persisted / 200 KB per terminal |
| 46 | Plugin API for third-party block actions | None in VS Code ext space | Beat | Eri agent registry already exposes this |
| 47 | YAML config | Terminals Manager | Skip | JSON; one less dependency |
| 48 | Recipe = one-shot spawn N terminals | Terminals Manager | Match | Subsumed by layout restore |
| 49 | Plugin manager analogue | TPM | Skip | VS Code Marketplace exists |
| 50 | Tmux pass-through (run tmux inside terminal) | trivially possible | Match | No special work; user can if they want |

---

## 9. License hygiene

**Pattern study vs code reuse.** Every reference in this document is to public
documentation, blog posts, README files, or the visible UX of a running
binary. No source code from any of the surveyed projects was read line by
line, and no code was copied. The competitive landscape is studied at the
*architectural pattern* level, which is not copyrightable.

**iTerm2 is GPLv2.** This means: any port of iTerm code would force eri's
terminal module to GPL, which is incompatible with the rest of the codebase
(MIT/Apache for the panel, fork relicensing risk for VSCodium-derived bits).
The rule is hard: zero iTerm code touched, ever. Patterns (arrangements,
triggers, hotkey, shell integration semantics) are concepts and freely
borrowable.

**tmux is BSD-2-clause.** Code-pattern borrowing is allowed with attribution,
but eri does not need to port tmux code — the patterns we want (sessions,
detach/attach mental model) are conceptual.

**Warp is closed source.** We rely strictly on documented features and public
blog posts. The one Warp asset that is open source — the
`warpdotdev/workflows` repo, Apache 2.0 — can be used directly with
attribution. We adopt its YAML schema as eri's workflow format.

**VS Code is MIT.** Extension API surface is free to use. The editor source
itself is MIT for the open parts; the Microsoft-branded build adds
proprietary additions that we do not depend on (we ship via VSCodium-style
build).

**Wave Terminal, WezTerm, Ghostty, Alacritty, Tabby, Hyper.** All MIT or
Apache 2.0. Their patterns are freely borrowable; their code stays untouched
because eri does not ship a renderer.

**Other extensions surveyed.** All MIT in our sample. Pattern borrowing is
unrestricted; we do not lift code.

**Practical posture.** Eri's terminal module is built from scratch against
the VS Code API, with patterns informed by the field. The license file at
the root of `extensions/eri-ai-panel` controls; nothing in this brief
changes that posture. The audit trail is: this document, the OSS patterns
brief, and the code itself — all written de novo.

---

## 10. Source URLs

- [source: docs.warp.dev/features/blocks]
- [source: warp.dev/blog/launching-warp-agent-mode]
- [source: docs.warp.dev/features/warp-drive/notebooks]
- [source: github.com/warpdotdev/workflows]
- [source: docs.warp.dev/features/warp-drive]
- [source: warp.dev/pricing]
- [source: iterm2.com/documentation-preferences-profiles-general.html]
- [source: iterm2.com/documentation-arrangements.html]
- [source: iterm2.com/documentation-tmux-integration.html]
- [source: iterm2.com/documentation-shell-integration.html]
- [source: man tmux(1)]
- [source: github.com/tmux-plugins/tmux-resurrect]
- [source: github.com/tmux-plugins/tmux-continuum]
- [source: github.com/tmuxinator/tmuxinator]
- [source: code.visualstudio.com/api/references/vscode-api#window]
- [source: code.visualstudio.com/api/references/vscode-api#TerminalShellIntegration]
- [source: code.visualstudio.com/api/references/vscode-api#TerminalShellExecution]
- [source: code.visualstudio.com/api/references/vscode-api#TreeDragAndDropController]
- [source: github.com/wavetermdev/waveterm]
- [source: github.com/wez/wezterm]
- [source: github.com/ghostty-org/ghostty]
- [source: github.com/atuinsh/atuin]
- [source: bun.sh/docs]
