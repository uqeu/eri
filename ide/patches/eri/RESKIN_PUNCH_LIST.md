# eri Reskin Punch List (vs raw VSCodium)

> Compiled 2026-05-20 from web research on Cursor's "Anysphere" visual identity.
> Each row maps to a patch file in this directory. Patches stack on top of VSCodium's de-MS patches.

## 1. Color tokens (Anysphere dark theme as the eri default)

Lives in `extensions/theme-defaults/themes/eri-dark-color-theme.json`. Register as the default theme via `product.json` and set `workbench.colorTheme` in default settings.

| Token | eri value | (was VSCode Dark+) |
|---|---|---|
| `editor.background` | `#181818` | `#1e1e1e` |
| `editor.foreground` | `#d6d6dd` | `#d4d4d4` |
| `activityBar.background` | `#181818` | `#333333` |
| `activityBar.foreground` | `#e3e1e3` | `#ffffff` |
| `activityBarBadge.background` | `#228df2` | `#007acc` |
| `sideBar.background` | `#181818` | `#252526` |
| `sideBarSectionHeader.background` | `#18181800` | `#80808033` |
| `statusBar.background` | `#181818` (flat, matches editor) | `#007acc` (blue) |
| `titleBar.activeBackground` | `#181818` | `#3c3c3c` |
| `tab.activeBackground` | `#181818` | `#1e1e1e` |
| `tab.activeBorderTop` | `#d6d6dd` (white underline) | none |
| `tab.border` | `#292929` | `#252526` |
| `button.background` | `#228df2` | `#0e639c` |
| `panel.border` | `#383838` | `#80808059` |
| `focusBorder` | transparent | `#007fd4` |
| `list.activeSelectionBackground` | `#163761` | `#094771` |

Net effect: everything collapses to a single near-black `#181818` with thin `#292929` borders, blue accent `#228df2`, white active-tab underline. **Status bar loses the famous VSCode blue** — this is the single biggest "Cursor-feeling" change.

## 2. Chrome / layout (patch the workbench)

1. **Activity bar horizontal at top of side bar.** Default `workbench.activityBar.orientation: "horizontal"` in `src/vs/workbench/common/configuration.ts`.
2. **Custom monogram top of activity bar.** Inject in `src/vs/workbench/browser/parts/activitybar/activitybarPart.ts`; style in `media/activitybar.css`.
3. **AI chat pinned as default-open right auxiliary bar.** Register a view container under `src/vs/workbench/contrib/eriChat/`. Default `workbench.auxiliaryBar.visible: true` and `workbench.secondarySideBar.defaultVisibility: visible`.
4. **Status bar flat dark** (theme token only; no code).
5. **Tab active = top-border underline, not bottom.** `tab.activeBorderTop` token + ensure `editor.background == tab.activeBackground` so the tab bleeds into the editor.
6. **Custom title bar everywhere.** `window.titleBarStyle: "custom"`, `window.customTitleBarVisibility: "auto"` in `src/vs/platform/window/common/window.ts` defaults.
7. **Hide "Welcome to VSCode" walkthrough.** Override `src/vs/workbench/contrib/welcomeGettingStarted/common/gettingStartedContent.ts`.
8. **Transparent sidebar section headers** (theme token alone gets this).

## 3. AI panel (right auxiliaryBar)

- Default width `420px`. Set `workbench.auxiliaryBar.defaultSize` in default settings.
- Background reads `--vscode-editor-background` (not sideBar). Override `.part.auxiliarybar` in `media/auxiliarybarpart.css`.
- **Model picker pill** at top of input: `border-radius: 9999px; padding: 2px 8px;` + chevron right.
- **Message bubbles:** user messages have `#212121` card with `8px` radius; assistant replies flush-left, no bubble.
- Typography: `font-family: var(--vscode-font-family)`; chat copy `13px / 1.55` line-height.
- Mode tabs (Voice / Agent / Ask / Manual) above input — segmented control.

## 4. Cmd-K inline edit overlay

- **Zone widget** inserted inline at cursor row (NOT a modal). Extend `src/vs/editor/contrib/zoneWidget/`.
- Width matches editor column, `560px` min. Background `#1d1d1d`, `1px` border `#383838`, `6px` radius.
- Single-line prompt + small model pill right + Esc/Enter hint footer in `--vscode-descriptionForeground`.
- On submit: inline green/red gutter diff + Accept/Reject buttons at foot.

## 5. Command palette

- Same VSCode geometry. **Prepend AI-action results** ("Ask AI: …", "Edit: …") at the top of the list.
- Extend `src/vs/workbench/contrib/quickaccess/` with a default provider.
- Quick input background `#1d1d1d`.

## 6. Welcome page

Replace walkthrough definitions in `src/vs/workbench/contrib/welcomeGettingStarted/common/gettingStartedContent.ts`:
- Hero: eri wordmark + "Sign in" CTA + "Continue without account."
- Tiles: "Try inline edit (Cmd-K)", "Open chat (Cmd-L)", "Import VS Code settings", "Open folder", "Clone repo."
- Recents list bottom-left. No "Learn" / "Help" footers.

## 7. Marketplace

OpenVSX already wired by VSCodium. Optional top banner "Powered by Open VSX" in `src/vs/workbench/contrib/extensions/browser/extensionsViewlet.ts`.

## 8. First-run onboarding

Overlay shown when `telemetry.firstSessionDate` unset. Contribution under `src/vs/workbench/contrib/welcomeWalkthrough/`:
1. Sign-in modal (email / Google / GitHub).
2. "Import from VS Code" prompt (keybindings, settings, extensions).
3. Theme/keybinding preset (VS Code / JetBrains / Vim).
4. Tab-completion toggle.

## 10. Diffusion preview (native webview, beside editor)

The diffusion preview lives **inside the IDE** as a `vscode.window.createWebviewPanel` with `ViewColumn.Beside`. No external Swift WKWebView sidecar.

- Owned by the bundled `eri-ai-panel` extension.
- Webview HTML wraps an `<iframe src="file://<session>/index.html">` with a tiny overlay (URL bar + reload + open-in-browser).
- A `vscode.workspace.createFileSystemWatcher("**/.eri/sessions/*/index.html")` reloads the iframe whenever Mercury 2 partial-HTML lands.
- Opens automatically when:
  - User says a new build prompt (intent classifier → `NewBuild`)
  - User clicks an entry in the iteration history sidebar
- CSP: `default-src 'none'; img-src vscode-resource: https:; script-src 'unsafe-inline'; style-src 'unsafe-inline'` (local prototypes, sandboxed iframe inside webview).
- Tab title: the iteration's short label ("coffee-shop landing"); tab icon: small eri glyph.

## 11. Iteration history sidebar (primary view)

The left sidebar's primary view is the **iteration history**, not the file explorer. Files become a secondary tab below.

- New view container under `src/vs/workbench/contrib/eriIterations/`.
- Tree provider reads from `<workspace>/.eri/sessions/<sid>/iterations/NNNN-*.{html,txt}` (the existing `eri_iterator::log_iteration` output).
- Each row: `⏵ 0003-edit · 3s ago · ✓` with a tiny preview thumbnail on hover.
- Click → opens that iteration's HTML in the preview webview AND moves the cursor in the editor to the matching diff.
- Right-click → "Fork from here" (creates a new session branched off this iteration), "Compare with current", "Export".

## 9. Branding plumbing (`product.json` + assets)

Edit `prepare_vscode.sh`-equivalent step, override `product.json`:
- `nameShort: "Eri"`, `nameLong: "Eri"`, `applicationName: "eri"`
- `dataFolderName: ".eri"`, `urlProtocol: "eri"`
- `darwinBundleIdentifier: "com.eri.Eri"`
- Replace icons: `resources/darwin/code.icns`, `resources/win32/code.ico`, `resources/linux/code.png`
- Replace `src/vs/workbench/browser/parts/editor/media/letterpress*.svg` (empty-editor wordmark)
- Replace `src/vs/code/electron-sandbox/workbench/workbench.html` favicon

## Patch-file mapping

| Patch | Covers |
|---|---|
| `eri-01-product-json.patch` | §9 — branding plumbing in `product.json` |
| `eri-02-default-theme.patch` | §1 — Anysphere theme JSON + register as default |
| `eri-03-activity-bar.patch` | §2.1–§2.2 — horizontal activity bar + monogram |
| `eri-04-ai-panel.patch` | §2.3 + §3 — auxiliaryBar AI view container + chrome |
| `eri-05-cmdk-overlay.patch` | §4 — zone-widget inline edit |
| `eri-06-welcome.patch` | §6 — replace walkthrough content |
| `eri-07-cmd-palette-ai.patch` | §5 — prepend AI actions in quickaccess |
| `eri-08-statusbar-mic.patch` | §2.4 + status-bar mic indicator + diffusion-fire pulse |
| `eri-09-onboarding.patch` | §8 — first-run overlay |
| `eri-10-preview-webview.patch` | §10 — diffusion preview as native webview panel beside editor, auto-reloads on Mercury stream writes |
| `eri-11-iteration-sidebar.patch` | §11 — left sidebar view: iteration history (primary) + files (secondary tab) |

## Cheat sheet: files we'll touch most often

- `src/vs/workbench/browser/parts/activitybar/{activitybarPart.ts,media/activitybar.css}`
- `src/vs/workbench/browser/parts/auxiliarybar/`
- `src/vs/workbench/browser/parts/statusbar/`
- `src/vs/workbench/browser/parts/titlebar/`
- `src/vs/workbench/browser/parts/editor/{tabsTitleControl.ts,media/tabstitlecontrol.css}`
- `src/vs/workbench/contrib/welcomeGettingStarted/`
- `src/vs/workbench/contrib/quickaccess/`
- `src/vs/editor/contrib/zoneWidget/`
- `extensions/theme-defaults/themes/`
- `src/vs/workbench/common/configuration.ts`
- `src/vs/platform/window/common/window.ts`
- `product.json`

## Sources

- [Replicating the VS Code Experience in Cursor (Medium)](https://medium.com/@ssuuribaatar/replicating-the-vs-code-experience-in-cursor-a-guide-to-customizing-your-ui-f0071c55953a)
- [Cursor: Customize Your Sidebar Like VS Code (Trung Vo)](https://trungvose.com/blog/cursor-customize-sidebar-vscode-style/)
- [Cursor Themes docs](https://cursor.com/docs/configuration/themes)
- [Cursor Inline Edit docs](https://cursor.com/docs/inline-edit/overview)
- [Anysphere theme JSON (hasokeric mirror)](https://github.com/hasokeric/cursor-anysphere-theme)
- [Cursor forum — AI chat panel uses editor color, not sidebar color](https://forum.cursor.com/t/ai-chat-panel-background-uses-editor-color-instead-of-sidebar-color-workaround-included/157025)
- [VSCodium product.json customization (DeepWiki)](https://deepwiki.com/VSCodium/vscodium/6.1-product.json-customization)
- [VSCodium prepare_vscode.sh](https://github.com/VSCodium/vscodium/blob/master/prepare_vscode.sh)
