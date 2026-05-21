# eri ⟷ Cursor Feature Parity Spec

> Compiled 2026-05-20. The goal: every visible Cursor feature has an eri equivalent surface.
> Implementation depth varies — some land as full features, some as scaffold-stubs that
> emit `eri/<feature>/*` JSON-RPC calls into the Rust sidecar (which can fill them in later).

## Implementation surface map

Each feature owns a file/folder in the bundled extension so parallel agents don't collide.

| # | Cursor feature | eri surface | Owner file/folder | Status |
|---|---|---|---|---|
| 1 | Tab completion (predictive multi-line) | `eri.tab` provider | `extensions/eri-ai-panel/src/tab/` | scaffold |
| 2 | Cmd-K inline edit | `eri.inlineEdit` | `vscode/src/vs/editor/contrib/eriInlineEdit/` (patch) + handler | scaffold |
| 3 | Composer (multi-file edits) | `eri.composer` | `extensions/eri-ai-panel/src/composer/` | scaffold |
| 4 | Agent mode (autonomous) | `eri.agent` | `extensions/eri-ai-panel/src/agent/` | scaffold |
| 5 | Chat panel | already in `panel.ts` | `extensions/eri-ai-panel/src/panel.ts` | done |
| 6 | @-mentions (file/folder/web/docs/codebase) | `eri.mentions` | `extensions/eri-ai-panel/src/mentions/` | scaffold |
| 7 | Codebase indexing | `eri.index` | `extensions/eri-ai-panel/src/index/` | scaffold |
| 8 | Web search integration | `eri.web` | `extensions/eri-ai-panel/src/web/` | scaffold |
| 9 | Image input (multimodal) | `eri.images` | `extensions/eri-ai-panel/src/images/` | scaffold |
| 10 | Custom rules / `.erirules` | `eri.rules` | `extensions/eri-ai-panel/src/rules/` | scaffold |
| 11 | MCP (Model Context Protocol) | `eri.mcp` | `extensions/eri-ai-panel/src/mcp/` | scaffold |
| 12 | Privacy mode | `eri.privacy` setting | `extensions/eri-ai-panel/package.json` | done |
| 13 | Background / Cloud agents | `eri.cloudAgent` | `extensions/eri-ai-panel/src/cloud/` | scaffold |
| 14 | Bug Finder / Bug Bot | `eri.bugFinder` | `extensions/eri-ai-panel/src/bugFinder/` | scaffold |
| 15 | Multi-model routing | `eri.modelRouter` | `extensions/eri-ai-panel/src/modelRouter/` | scaffold |
| 16 | Apply (one-click diff apply) | `eri.apply` | `extensions/eri-ai-panel/src/apply/` | scaffold |
| 17 | Terminal AI (run command in terminal) | `eri.terminal` | `extensions/eri-ai-panel/src/terminal/` | scaffold |
| 18 | Notepad (scratchpad with context) | `eri.notepad` | `extensions/eri-ai-panel/src/notepad/` | scaffold |
| 19 | Git integration (commit msgs, etc) | `eri.git` | `extensions/eri-ai-panel/src/git/` | scaffold |
| 20 | Linter integration | `eri.lint` | `extensions/eri-ai-panel/src/lint/` | scaffold |
| 21 | Code review | `eri.review` | `extensions/eri-ai-panel/src/review/` | scaffold |
| 22 | Documentation search (`@docs`) | part of `mentions/` | — | scaffold |
| 23 | Pull request creation | `eri.pr` | `extensions/eri-ai-panel/src/pr/` | scaffold |
| 24 | Branch automation | part of `git/` | — | scaffold |
| 25 | Voice (eri differentiator, not in Cursor) | `eri.voice` (sidecar) | `crates/eri_voice/` + sidecar | done |
| 26 | Diffusion preview (eri differentiator) | `eri.preview` | `extensions/eri-ai-panel/src/preview.ts` | done |
| 27 | Iteration history (eri differentiator) | `eri.iterations` | `extensions/eri-ai-panel/src/iterations/` | scaffold |
| 28 | Gaze targeting (eri differentiator) | `eri.gaze` (sidecar) | `crates/eri_gaze/` | done |

## Scaffold contract

Each scaffold MUST:

1. Define a TypeScript module that exports an `activate(context, sidecar)` function or a class with a similar shape.
2. Register any commands it owns in the extension's `package.json` `contributes.commands` array (and keybindings if applicable, avoiding the Cursor-claimed keybinds in `CURSOR_DEFAULTS.md`).
3. Wire any sidecar calls as `sidecar.notify("eri/<feature>/<verb>", params)` or `sidecar.request("eri/<feature>/<verb>", params)`.
4. Stub user-facing UI with the eri palette (`#181818` bg, `#d6d6dd` fg, `#228df2` accent, `#e0ff4f` eri-accent, `#292929` borders, `#212121` cards).
5. Be importable from `src/extension.ts` via a single line `import { activate as activateFoo } from "./foo";` then `activateFoo(context, sidecar);`.

## What "feature parity" means here

Cursor took years to ship all 24 features. We're not catching up overnight. The point of this spec:

- **All 24 features have a registered command and a stub UI** in eri's first build — so the IDE *looks* feature-complete to a Cursor migrant.
- **The sidecar protocol has a method name reserved for each** — so Rust-side implementation can land incrementally without changing the wire format.
- **Marketing copy on the website lists all 24** truthfully (e.g., "Coming this quarter" vs "Available now").

The eri differentiators (voice, gaze, diffusion preview, iteration history) are NOT Cursor parity — they're the answer to "why eri instead of Cursor?".
