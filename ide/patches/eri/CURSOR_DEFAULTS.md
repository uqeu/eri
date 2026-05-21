# Cursor Defaults — Reference for eri OOTB Experience

Public/observed defaults Cursor ships, gathered from `cursor.com/docs`, the Cursor changelog,
the Cursor community forum, and third-party gists. Marked `# UNCONFIRMED` where sources disagree
or were not directly verifiable. We adapt these into eri's defaults; do not copy proprietary
themes/extensions verbatim.

## 1. Default `settings.json` values

Cursor inherits VSCode defaults except where its first-run config or product.json overrides them.
The observable deltas vs upstream VSCode:

```jsonc
"editor.fontSize": 14                            # VSCode default; Cursor keeps it
"editor.lineHeight": 0                            # 0 = auto-derived from fontSize; Cursor keeps default
"editor.fontFamily": "Menlo, Monaco, 'Courier New', monospace"  # UNCONFIRMED — Cursor has not switched to Geist/JetBrains Mono; community feature-requests it
"editor.fontLigatures": false                     # VSCode default
"editor.smoothScrolling": false                   # default; Cursor known-bug at non-default zoom (forum)
"editor.minimap.enabled": true                    # VSCode default
"editor.stickyScroll.enabled": true               # VSCode default since 1.84; Cursor inherits
"editor.inlineSuggest.enabled": true              # required for Cursor Tab
"editor.wordWrap": "off"                          # VSCode default
"editor.formatOnSave": false                      # VSCode default (off)
"files.autoSave": "off"                           # VSCode default; Cursor does not enable autosave OOTB
"breadcrumbs.enabled": true                       # VSCode default
"workbench.tree.indent": 8                        # VSCode default; Cursor inherits
"workbench.tree.enableStickyScroll": true         # VSCode default since 1.86
"workbench.colorTheme": "Default Dark Modern"     # baseline; Cursor's own "Cursor Dark" is selectable
"workbench.iconTheme": "vs-seti"                  # VSCode default
"workbench.startupEditor": "welcomePage"          # Cursor shows its own welcome/onboarding
"terminal.integrated.fontSize": 12                # VSCode default
"git.decorations.enabled": true                   # VSCode default
"git.autofetch": false                            # VSCode default
"telemetry.telemetryLevel": "all"                 # Cursor has its own telemetry toggle, separate from VSCode's

# Cursor-specific keys (namespace varies by version; observed in community settings dumps)
"cursor.cpp.enablePartialAccepts": true           # Cmd+Right partial-word accept
"cursor.chat.defaultMode": "agent"                # agent persists across conversations when enabled
"cursor.general.enableShadowWorkspace": false     # UNCONFIRMED default
"cursor.codebaseIndexing.autoIndex": true         # auto-indexes folders <10,000 files
"cursor.tab.suggestionDelayMs": 300               # community-cited default
```

## 2. Default keybindings (additions over VSCode, macOS)

From `cursor.com/docs/configuration/kbd`:

```
Cmd+K              # Inline edit (surgical) in editor
Cmd+L              # Add selection to new chat / toggle sidepanel
Cmd+I              # Toggle chat sidepanel / Composer
Cmd+E              # Activate Agent layout
Cmd+.              # Open Mode menu
Cmd+/              # Cycle AI models
Cmd+Shift+L        # Add selection as context to existing chat
Cmd+Shift+K        # Toggle focus into inline edit input
Cmd+Shift+J        # Open Cursor Settings pane
Cmd+Shift+Space    # Toggle Voice Mode
Cmd+Shift+Backspace # Stop generation / discard inline edit
Cmd+Return         # Force-send while typing / Apply all proposed changes
Cmd+Backspace      # Reject all suggested changes
Ctrl+Return        # Queue message
Cmd+N / Cmd+R      # New chat session
Cmd+T              # New chat tab
Cmd+[  /  Cmd+]    # Prev / next chat
Cmd+M              # File-read strategy menu
Opt+Return         # Quick follow-up question in inline edit
Tab                # Accept Tab suggestion / completion
Cmd+Right          # Accept next word of suggestion (partial accept)
Esc                # Reject suggestion
```

Windows/Linux: substitute `Ctrl` for `Cmd`, `Alt` for `Opt`.

## 3. Default extensions

Cursor does **not** ship a curated pre-install bundle. On first launch it offers one-click
**Import from VSCode** (extensions, themes, icons, keybindings, user settings, snippets);
otherwise the user installs from the Open VSX registry. Built-ins are the standard VSCode
contributed extensions (TypeScript/JS language features, JSON, Markdown, Git, etc.).
No "Cursor Recommended Pack" is bundled. # UNCONFIRMED for any silent pre-installs.

## 4. Subtle chrome / UI defaults worth matching

```jsonc
"editor.cursorBlinking": "blink"                  # VSCode default
"editor.cursorSmoothCaretAnimation": "off"        # VSCode default
"editor.renderWhitespace": "selection"            # VSCode default
"editor.guides.bracketPairs": false               # VSCode default (Cursor does not force-enable)
"editor.bracketPairColorization.enabled": true    # VSCode default since 1.67
"workbench.editor.enablePreview": true            # VSCode default
"workbench.editor.showTabs": "multiple"           # VSCode default
"workbench.activityBar.location": "default"       # Cursor keeps left activity bar
"workbench.sideBar.location": "left"              # default
"window.commandCenter": true                      # VSCode default since 1.86
"window.titleBarStyle": "custom"                  # Cursor uses custom titlebar on macOS
"explorer.compactFolders": true                   # VSCode default
"editor.suggestSelection": "first"                # VSCode default
```

## 5. Onboarding presets

Cursor's onboarding does **not** present discrete "VSCode / JetBrains / Vim" preset bundles
the way Windsurf does. The single first-run choice is **Import from VSCode** (yes/no).
JetBrains and Vim feels are achieved post-onboarding via Open VSX extensions
(`k--kato.intellij-idea-keybindings`, `vscodevim.vim`); Cursor does not auto-install them.
Keymap can later be re-imported from `Settings > General > Account > Import VS Code Settings`.
# UNCONFIRMED whether 2026 builds added a keymap picker.

## 6. Built-in themes

From `cursor.com/docs/configuration/themes` and the 0.47 release notes:

- **Cursor Dark** (default after 0.47)
- **Cursor Midnight**
- **Cursor Dark High Contrast**
- **Default Dark Modern** (inherited from VSCode)
- **Default Light Modern** (inherited from VSCode)
- All other VSCode stock themes (Dark+, Light+, Monokai, Solarized, Quiet Light, Red, Tomorrow Night Blue, Kimbie Dark, Abyss, High Contrast)

**Anysphere Dark** was the pre-0.47 default and was removed from built-ins; it now lives as a
marketplace extension. Do not vendor it into eri.

Default icon theme: `vs-seti`. No custom Cursor icon theme ships as a built-in. # UNCONFIRMED

---

**Sources**
- https://cursor.com/docs/configuration/kbd
- https://cursor.com/docs/configuration/themes
- https://cursor.com/docs/configuration/migrations/vscode
- https://docs.cursor.com/settings/preferences
- https://forum.cursor.com/t/set-jetbrains-mono-as-the-default-font-in-cursor/140923
- https://forum.cursor.com/t/anysphere-dark-theme-in-0-47/64554
- https://forum.cursor.com/t/editor-smoothscrolling-not-working-when-ide-zoom-is-not-default/159495
- https://gist.github.com/tomoima525/034c7f4360f238bbbdfe5b037937dcd6
