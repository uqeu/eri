# Terminal Organization — OSS Patterns Survey

Survey of open-source VS Code extensions and terminal multiplexers that solve "many
terminals well." Notes are pattern-level only; no code was copied. Findings drive
the eri.terminals module design.

## Sources Reviewed

1. **VS Code Terminal API** (official docs, `vscode-api#Terminal`,
   `TerminalShellIntegration`, `TerminalDataWriteEvent`, `TreeDragAndDropController`)
   — the source of truth. Confirmed:
   - `vscode.window.terminals` is the read-only canonical list.
   - `onDidOpenTerminal`/`onDidCloseTerminal` fire on every native lifecycle event.
   - `Terminal.shellIntegration` (since 1.85) exposes per-terminal
     `executeCommand`, `cwd`, and `onDidExecuteCommand` with `exitCode` + output
     stream.
   - `TerminalDataWriteEvent` is proposed API (only available behind
     `vscode.proposed.terminalDataWriteEvent`); cannot rely on it without an
     enableProposedApi flag — we use shell integration as the primary source and
     fall back to a timer-based idle heuristic.
   - TreeView supports drag-and-drop via `TreeDragAndDropController<T>` since
     1.66.
2. **Terminal Tabs** (Tyriar, MIT) — confirms the pattern of mirroring native
   terminals into a `TreeDataProvider` with click → `terminal.show()`. Uses
   `EventEmitter` + `onDidChangeTreeData` to refresh on open/close.
3. **Terminals Manager** (fabiospampinato, MIT) — config-driven recipe runner.
   Recipes are YAML lists of `{name, cwd, commands}`. Spawn loop:
   `createTerminal({name, cwd})` then `sendText(cmd)`. We adopt this minus the
   YAML dep (we use JSON).
4. **Restore Terminals** (EthanSK, MIT) — pattern for surviving window reload.
   Lesson: VS Code already persists terminals if `terminal.integrated.persistentSessionReviveProcess`
   is enabled; the extension only persists the *organization layer* (group +
   custom name + lock flag) keyed by `Terminal.processId` or by terminal name.
   Since `processId` is unstable across reloads we key by `name` + group, with a
   best-effort cwd hint.
5. **Warp** (proprietary, but public blog posts describe the *block* model):
   each completed command + its output is a discrete, addressable unit with an
   id, exit code, duration, copy/share/rerun actions. We re-create this with the
   VS Code shell-integration stream — no Warp code touched.
6. **iTerm2 arrangements** (GPL) — read the user-facing docs only. An
   arrangement is a named snapshot of windows × tabs × panes including starting
   commands. Direct translation: a JSON layout file per workspace under
   `.eri/terminal-layouts/<name>.json`.
7. **tmux** — public design docs (man page + tao-of-tmux). Sessions are named,
   persistent across detach. We mirror this conceptually: each "layout" is a
   session; spawning the layout is attach.

## Patterns Worth Borrowing

- **Tree mirrors VS Code state, never owns it.** All terminals come from
  `vscode.window.terminals`; the tree provider is a *projection*. This avoids
  the bug class where the tree shows zombie terminals after VS Code kills them.
- **Persist by structural identity, not pointer identity.** Keep a workspace-
  scoped record `{ terminalKey: groupId }` where the key is
  `name + cwd + creationOrder`. On reload, re-bind newly-discovered terminals
  to their group by best match.
- **Shell integration first, heuristics as fallback.** When integration is
  available we get exact command boundaries + exit codes. When not (nushell,
  custom prompts), we degrade to: first-line-after-prompt rename + idle timer
  for status. No block capture in degraded mode (UI shows "shell integration
  unavailable — enable for command blocks").
- **Auto-name on first substantive command, then lock-on-edit.** Several
  managers rename to `npm run dev`. Our refinement: a synonyms table for
  common scripts (`npm run dev → "dev server"`, `cargo run → "cargo run"`,
  `npm test → "tests"`). After the user edits the name, set the lock flag and
  never auto-rename again.
- **Cwd auto-grouping by longest-prefix.** A new terminal joins the group whose
  cwd is the closest ancestor of its cwd. If no group matches, create a new
  group named after the last path segment. Identical to how file watchers
  partition by repo root.
- **Bounded block storage.** Cap at 200 blocks in memory, 50 persisted per
  terminal, 200 KB total output per terminal. Discard oldest first. Keeps
  globalState quota sane.
- **Local-only audit log.** A single-line-JSON file at `.eri/audit.log` with
  spawn/kill/layout/block events. Useful for debugging + future enterprise
  introspection. Never networked.

## What We Are Not Borrowing

- iTerm2's split-pane layout — VS Code doesn't expose pane geometry, so we
  model arrangements as a flat list of `{group, name, cwd, command}`.
- Warp's full TUI rendering — we keep VS Code's native terminal renderer
  untouched. Our "blocks" view is a side panel summary, not a replacement
  surface.
- Any code from GPL sources (iTerm2 internals).
