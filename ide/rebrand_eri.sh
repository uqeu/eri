#!/usr/bin/env bash
# Rebrand the prepared vscode/ tree from VSCodium → eri.
# Called from build.sh after `. prepare_vscode.sh` and before `npm run gulp`.
# At this point, cwd is the `vscode/` directory.
set -e

echo "[eri] rebrand: starting"

# Helper from utils.sh — defines setpath().
. ../utils.sh

# ---------------------------------------------------------------------------
# 0. Aggressive Microsoft / Visual Studio Code identity sweep.
#    Runs before any other rebrand modifications so subsequent steps see
#    already-cleansed strings. Only touches user-visible strings inside
#    localize() calls, .nls.json catalogs, product.json, and extension
#    package.json descriptions — never source-file copyright headers or
#    programmatic publisher ids.
# ---------------------------------------------------------------------------
if [[ -x ../eri_nuke_microsoft.sh ]]; then
  echo "[eri] running aggressive Microsoft sweep"
  bash ../eri_nuke_microsoft.sh
fi

# ---------------------------------------------------------------------------
# 1. Strip Copilot / GitHub-AI extensions from the built-in bundle.
#    `prepare_vscode.sh` already removes `extensions/copilot`; we are
#    defensive about every variant Microsoft ships, plus the auth providers
#    that surface the "Continue with GitHub" welcome flow.
# ---------------------------------------------------------------------------
echo "[eri] purging Copilot/GitHub-AI built-in extensions"
for dir in \
  extensions/copilot \
  extensions/copilot-chat \
  extensions/github-copilot-chat \
  extensions/github-authentication \
  extensions/github \
  extensions/microsoft-authentication; do
  if [[ -d "${dir}" ]]; then
    echo "[eri]   rm -rf ${dir}"
    rm -rf "${dir}" 2>/dev/null || true
  fi
done

# ---------------------------------------------------------------------------
# 2. product.json identity overrides — eri.
# ---------------------------------------------------------------------------
setpath "product" "nameShort" "eri"
setpath "product" "nameLong" "eri"
setpath "product" "applicationName" "eri"
setpath "product" "dataFolderName" ".eri"
setpath "product" "linuxIconName" "eri"
setpath "product" "urlProtocol" "eri"
setpath "product" "serverApplicationName" "eri-server"
setpath "product" "serverDataFolderName" ".eri-server"
setpath "product" "darwinBundleIdentifier" "dev.eri.app"
setpath "product" "win32AppUserModelId" "Eri.Eri"
setpath "product" "win32DirName" "eri"
setpath "product" "win32MutexName" "eri"
setpath "product" "win32NameVersion" "eri"
setpath "product" "win32RegValueName" "eri"
setpath "product" "win32ShellNameShort" "eri"
setpath "product" "tunnelApplicationName" "eri-tunnel"
setpath "product" "win32TunnelServiceMutex" "eri-tunnelservice"
setpath "product" "win32TunnelMutex" "eri-tunnel"
setpath "product" "reportIssueUrl" "https://github.com/uqeu/eri/issues/new"
setpath "product" "licenseUrl" "https://github.com/uqeu/eri/blob/main/LICENSE"
setpath "product" "downloadUrl" "https://eri.dev/download"
setpath "product" "documentationUrl" "https://eri.dev/docs"
setpath "product" "releaseNotesUrl" "https://eri.dev/changelog"
setpath "product" "introductoryVideosUrl" "https://eri.dev/tour"
setpath "product" "keyboardShortcutsUrlMac" "https://eri.dev/docs/keybindings"
setpath "product" "keyboardShortcutsUrlLinux" "https://eri.dev/docs/keybindings"
setpath "product" "keyboardShortcutsUrlWin" "https://eri.dev/docs/keybindings"
setpath "product" "tipsAndTricksUrl" "https://eri.dev/docs/tips"
setpath "product" "twitterUrl" "https://x.com/eri_dev"
setpath "product" "requestFeatureUrl" "https://github.com/uqeu/eri/issues"
setpath "product" "webEndpointUrl" "https://eri.dev"

# ---------------------------------------------------------------------------
# 2a. Null out residual Copilot wiring + Microsoft URLs in product.json
# ---------------------------------------------------------------------------
echo "[eri] purging residual Copilot/Microsoft references in product.json"

# Null Copilot defaults
setpath_json "product" "defaultChatAgent" 'null'
setpath_json "product" "chatParticipantRegistry" 'null'
setpath "product" "chatExtensionId" ""
setpath "product" "chatExtensionOutputId" ""

# Rewrite all aka.ms / go.microsoft.com URLs to eri.dev equivalents via jq
TMP_PRODUCT=$(mktemp)
jq 'walk(if type == "string" then
        gsub("https://aka\\.ms/[^\"]*"; "https://eri.dev/docs/help")
      | gsub("https://go\\.microsoft\\.com/fwlink/[?][^\"]*"; "https://eri.dev/help")
      | gsub("https://code\\.visualstudio\\.com"; "https://eri.dev")
      | gsub("https://cla\\.opensource\\.microsoft\\.com[^\"]*"; "")
     else . end)' product.json > "$TMP_PRODUCT"
mv "$TMP_PRODUCT" product.json

# Remove microsoft-IsvExpTools.* entries from extensionAllowedProposedApi
TMP_PRODUCT=$(mktemp)
jq 'if .extensionAllowedProposedApi then
      .extensionAllowedProposedApi |= map(select(. | startswith("microsoft-IsvExpTools.") | not))
    else . end' product.json > "$TMP_PRODUCT"
mv "$TMP_PRODUCT" product.json

# Strip cla.opensource.microsoft.com from linkProtectionTrustedDomains
TMP_PRODUCT=$(mktemp)
jq 'if .linkProtectionTrustedDomains then
      .linkProtectionTrustedDomains |= map(select(. | contains("cla.opensource.microsoft.com") | not))
    else . end' product.json > "$TMP_PRODUCT"
mv "$TMP_PRODUCT" product.json

# Replace onboardingThemes with just eri Dark
setpath_json "product" "onboardingThemes" '[{"id": "eri Dark", "theme": "eri Dark", "icon": "$(eye)", "title": "eri Dark"}]'

# Update ms-vscode debug repo URLs in builtInExtensions
TMP_PRODUCT=$(mktemp)
jq 'if .builtInExtensions then
      .builtInExtensions |= map(
        if .name | startswith("ms-vscode.") then
          .repo = "https://github.com/uqeu/eri-bundled-extensions"
        else . end
      )
    else . end' product.json > "$TMP_PRODUCT"
mv "$TMP_PRODUCT" product.json

# ---------------------------------------------------------------------------
# 2b. String sweep — replace user-visible "Visual Studio Code" / "VS Code" in
# all shippable localize() calls under src/vs (not tests, not sessions/).
# This is idempotent and re-runnable; we invoke the standalone script so it
# can also be triggered manually after prepare_vscode.sh regenerates files.
# ---------------------------------------------------------------------------
if [[ -f "../eri_rebrand_strings.sh" ]]; then
  echo "[eri] running string sweep (eri_rebrand_strings.sh)"
  # We are currently inside vscode/. The sweep script expects to be invoked
  # from anywhere; it resolves vscode/ relative to its own path.
  bash ../eri_rebrand_strings.sh
else
  echo "[eri] WARN: ../eri_rebrand_strings.sh missing — skipping string sweep"
fi

# ---------------------------------------------------------------------------
# 3. Welcome / startup overrides — suppress eri's Copilot welcome.
# ---------------------------------------------------------------------------
echo "[eri] product.json: disabling Copilot welcome surfaces"
setpath_json "product" "openToWelcomeMainPage" 'false'
setpath_json "product" "walkthroughs" '[]'
setpath_json "product" "gitHubEntitlement" 'null'
setpath_json "product" "extensionAllowedProposedApi" '["eri.eri-ai-panel"]'

# ---------------------------------------------------------------------------
# 3a. Default theme + workbench defaults — eri's brand on first launch.
# ---------------------------------------------------------------------------
echo "[eri] product.json: setting eri Dark as initial theme + workbench defaults"
setpath "product" "initialColorTheme" "eri Dark"
setpath "product" "win32Name" "eri"
setpath_json "product" "configurationDefaults" '{
  "workbench.colorTheme": "eri Dark",
  "workbench.startupEditor": "none",
  "workbench.activityBar.location": "top",
  "workbench.statusBar.visible": true,
  "workbench.layoutControl.enabled": false,
  "window.titleBarStyle": "custom",
  "window.customTitleBarVisibility": "auto",
  "window.title": "${rootName} — eri",
  "window.density.editorTabHeight": "compact",
  "workbench.editor.showTabs": "single",
  "workbench.welcome.experimental.startupEditor": "none",
  "workbench.enableExperiments": false,
  "workbench.tree.indent": 14,
  "workbench.tree.renderIndentGuides": "always",
  "explorer.compactFolders": false,
  "breadcrumbs.enabled": true,
  "editor.fontFamily": "Berkeley Mono, JetBrains Mono, monospace",
  "editor.fontSize": 13,
  "editor.lineHeight": 1.6,
  "editor.minimap.enabled": false,
  "extensions.ignoreRecommendations": true,
  "update.mode": "none",
  "chat.commandCenter.enabled": false,
  "telemetry.telemetryLevel": "off"
}'

# ---------------------------------------------------------------------------
# 3b. Default layout — eri chat panel front-and-center, aux bar hidden.
# ---------------------------------------------------------------------------
setpath_json "product" "defaultLayout" '{
  "views": [
    {"id": "eri.panel", "order": 0, "visible": true},
    {"id": "eri.iterations", "order": 1, "visible": true},
    {"id": "eri.checkpoints", "order": 2, "visible": false},
    {"id": "eri.pendingEdits", "order": 3, "visible": false},
    {"id": "eri.terminals", "order": 4, "visible": false}
  ],
  "editors": [],
  "force": true,
  "layout": {
    "panel": {"hidden": false, "alignment": "center"},
    "auxiliaryBar": {"hidden": true},
    "statusBar": {"hidden": false},
    "sidebar": {"position": "left", "hidden": false}
  }
}'

# ---------------------------------------------------------------------------
# 4. Apply eri-specific patches if present.
# ---------------------------------------------------------------------------
if [[ -d "../patches/eri/" ]]; then
  ERI_PATCH_APPLIED=()
  ERI_PATCH_FUZZED=()
  ERI_PATCH_FAILED=()
  for file in ../patches/eri/*.patch; do
    if [[ -f "${file}" ]]; then
      name=$(basename "${file}")
      echo "[eri] applying patch: ${name}"
      if git apply --ignore-whitespace --ignore-space-change "${file}" 2>/dev/null; then
        echo "[eri]   OK (git apply): ${name}"
        ERI_PATCH_APPLIED+=("${name}")
      elif patch -p1 --fuzz=3 --forward --silent < "${file}" 2>/dev/null; then
        echo "[eri]   OK (patch --fuzz=3): ${name}"
        ERI_PATCH_FUZZED+=("${name}")
      else
        echo "[eri]   WARN: ${name} failed to apply — continuing build"
        ERI_PATCH_FAILED+=("${name}")
      fi
    fi
  done
  echo "[eri] patch summary: ${#ERI_PATCH_APPLIED[@]} clean / ${#ERI_PATCH_FUZZED[@]} fuzzed / ${#ERI_PATCH_FAILED[@]} failed"
  if (( ${#ERI_PATCH_FAILED[@]} > 0 )); then
    echo "[eri]   failed: ${ERI_PATCH_FAILED[*]}"
  fi
fi

# ---------------------------------------------------------------------------
# 4b. Surgically neuter VS Code core's "Build with Agent" / chat onboarding
#     contributions. eri's own walkthrough (extensions/eri-ai-panel) and the
#     EriSetup walkthrough from eri-06-welcome.patch drive first-launch UX —
#     we don't want the Copilot panel auto-opening or VS Code's chat setup
#     surfaces fighting for screen real estate. Edits are idempotent: each
#     block grep-guards itself with a unique ERI_DISABLED_* marker.
# ---------------------------------------------------------------------------
echo "[eri] disabling built-in chat / welcome contributions"

CHAT_CONTRIB="src/vs/workbench/contrib/chat/browser/chat.contribution.ts"
if [[ -f "${CHAT_CONTRIB}" ]] \
   && ! grep -q "ERI_DISABLED_CHAT_CONTRIBS" "${CHAT_CONTRIB}"; then
  echo "[eri]   patching ${CHAT_CONTRIB}"
  # Comment out the three workbench contribution registrations that drive
  # the GitHub Copilot welcome / setup / teardown surfaces. We keep the
  # imports + classes intact so anything that references them still type-
  # checks; only the Registry side effect is suppressed.
  perl -i -pe '
    s{^registerWorkbenchContribution2\(ChatGettingStartedContribution\.ID, ChatGettingStartedContribution, WorkbenchPhase\.Eventually\);}{// ERI_DISABLED_CHAT_CONTRIBS: $&};
    s{^registerWorkbenchContribution2\(ChatSetupContribution\.ID, ChatSetupContribution, WorkbenchPhase\.BlockRestore\);}{// ERI_DISABLED_CHAT_CONTRIBS: $&};
    s{^registerWorkbenchContribution2\(ChatTeardownContribution\.ID, ChatTeardownContribution, WorkbenchPhase\.AfterRestored\);}{// ERI_DISABLED_CHAT_CONTRIBS: $&};
  ' "${CHAT_CONTRIB}"
fi

CHAT_PARTICIPANT="src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts"
if [[ -f "${CHAT_PARTICIPANT}" ]] \
   && ! grep -q "ERI_DISABLED_CHAT_AUXBAR" "${CHAT_PARTICIPANT}"; then
  echo "[eri]   patching ${CHAT_PARTICIPANT}"
  # Force chat view container to AuxiliaryBar with isDefault=false so the
  # workbench doesn't show the "Build with Agent" panel on first launch.
  # The container still registers (so the chat session SERVICE remains
  # functional for eri's panel via vs/sessions/), it just isn't the
  # default aux-bar contribution.
  perl -i -pe '
    s{ViewContainerLocation\.AuxiliaryBar, \{ isDefault: true, doNotRegisterOpenCommand: true \}\);}{ViewContainerLocation.AuxiliaryBar, { isDefault: false, doNotRegisterOpenCommand: true }); // ERI_DISABLED_CHAT_AUXBAR};
  ' "${CHAT_PARTICIPANT}"
fi

CHAT_GETTING_STARTED="src/vs/workbench/contrib/chat/browser/actions/chatGettingStarted.ts"
if [[ -f "${CHAT_GETTING_STARTED}" ]] \
   && ! grep -q "ERI_DISABLED_GETTING_STARTED early-return" "${CHAT_GETTING_STARTED}"; then
  echo "[eri]   patching ${CHAT_GETTING_STARTED}"
  # Belt + braces: even if the registration above slips through, neuter
  # the ChatGettingStartedContribution constructor so it never wires up
  # its listeners. We inject an unconditional early-return immediately
  # after the `super();` call. We use python instead of perl-slurp to
  # avoid quoting drama and keep this idempotent across reruns.
  python3 - "${CHAT_GETTING_STARTED}" <<'PYEOF'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
src = p.read_text()
marker = 'ERI_DISABLED_GETTING_STARTED early-return'
if marker in src:
    sys.exit(0)
# Anchor: the constructor's super() call inside ChatGettingStartedContribution.
anchor = '\t) {\n\t\tsuper();\n'
inject = '\t) {\n\t\tsuper();\n\t\treturn; // ERI_DISABLED_GETTING_STARTED early-return\n'
if anchor not in src:
    print('[eri] WARN: chatGettingStarted constructor anchor not found', file=sys.stderr)
    sys.exit(0)
# Only patch the first occurrence (there is only one constructor in this file).
src = src.replace(anchor, inject, 1)
p.write_text(src)
PYEOF
fi

DESKTOP_CONTRIB="src/vs/workbench/electron-browser/desktop.contribution.ts"
if [[ -f "${DESKTOP_CONTRIB}" ]] \
   && ! grep -q "ERI_DISABLED_SHELL_SCRIPT" "${DESKTOP_CONTRIB}"; then
  echo "[eri]   patching ${DESKTOP_CONTRIB}"
  # Don't ship the `Install 'code' command in PATH` action — that's a
  # VS Code-branded onboarding nudge that doesn't apply to eri.
  perl -i -pe '
    s{^(\s*)registerAction2\(InstallShellScriptAction\);}{$1// ERI_DISABLED_SHELL_SCRIPT: $&};
    s{^(\s*)registerAction2\(UninstallShellScriptAction\);}{$1// ERI_DISABLED_SHELL_SCRIPT: $&};
  ' "${DESKTOP_CONTRIB}"
fi

WELCOME_AGENT_SESSIONS="src/vs/workbench/contrib/welcomeAgentSessions/browser/agentSessionsWelcome.contribution.ts"
if [[ -f "${WELCOME_AGENT_SESSIONS}" ]] \
   && ! grep -q "ERI_DISABLED_AGENT_SESSIONS_WELCOME" "${WELCOME_AGENT_SESSIONS}"; then
  echo "[eri]   patching ${WELCOME_AGENT_SESSIONS}"
  # eri owns the welcome surface for agent sessions via its own walkthrough.
  perl -i -pe '
    s{^registerWorkbenchContribution2\(AgentSessionsWelcomeEditorResolverContribution\.ID, AgentSessionsWelcomeEditorResolverContribution, WorkbenchPhase\.BlockStartup\);}{// ERI_DISABLED_AGENT_SESSIONS_WELCOME: $&};
    s{^registerWorkbenchContribution2\(AgentSessionsWelcomeRunnerContribution\.ID, AgentSessionsWelcomeRunnerContribution, WorkbenchPhase\.AfterRestored\);}{// ERI_DISABLED_AGENT_SESSIONS_WELCOME: $&};
  ' "${WELCOME_AGENT_SESSIONS}"
fi

# Audit — confirm the neutering took effect.
echo "[eri] disable-state audit:"
for f in \
  "${CHAT_CONTRIB}" \
  "${CHAT_PARTICIPANT}" \
  "${CHAT_GETTING_STARTED}" \
  "${DESKTOP_CONTRIB}" \
  "${WELCOME_AGENT_SESSIONS}"; do
  if [[ -f "${f}" ]]; then
    n=$(grep -c "ERI_DISABLED_" "${f}" || true)
    echo "[eri]   ${f}: ${n} marker(s)"
  fi
done

# ---------------------------------------------------------------------------
# 5. Bundle the eri-ai-panel extension into the built-in extensions tree.
# ---------------------------------------------------------------------------
ERI_EXT_SRC="../extensions/eri-ai-panel"
ERI_EXT_DST="extensions/eri-ai-panel"
if [[ -d "${ERI_EXT_SRC}" ]]; then
  echo "[eri] bundling extension into ${ERI_EXT_DST}"
  rm -rf "${ERI_EXT_DST}"
  mkdir -p "${ERI_EXT_DST}"
  # Copy compiled output, package.json, media, etc.  Skip node_modules.
  ( cd "${ERI_EXT_SRC}" \
    && tar --exclude=node_modules --exclude=.vscode-test --exclude=src -cf - . ) \
    | ( cd "${ERI_EXT_DST}" && tar -xf - )
fi

# ---------------------------------------------------------------------------
# 6. Inject macOS permission strings into the Electron Info.plist template.
#    @vscode/gulp-electron writes the .app's Info.plist at packaging time
#    inside `node_modules/@vscode/gulp-electron/src/darwin.js`.  That module
#    only copies a fixed set of keys (CFBundleIdentifier, CFBundleName…), so
#    we patch it to additionally set our NS*UsageDescription keys whenever
#    `opts.darwinUsageDescriptions` is provided, then we provide that map by
#    appending it to the exported `config` object in `build/lib/electron.ts`.
# ---------------------------------------------------------------------------
GULP_ELECTRON_DARWIN="node_modules/@vscode/gulp-electron/src/darwin.js"
if [[ -f "${GULP_ELECTRON_DARWIN}" ]]; then
  if ! grep -q "ERI_USAGE_DESCRIPTIONS_INJECTED" "${GULP_ELECTRON_DARWIN}"; then
    echo "[eri] patching ${GULP_ELECTRON_DARWIN} to honor darwinUsageDescriptions"
    # Insert the injection block just before the final f.contents = ... at end
    # of patchInfoPlist.  We anchor on the unique line that builds the plist.
    python3 - "${GULP_ELECTRON_DARWIN}" <<'PYEOF'
import re, sys, pathlib
p = pathlib.Path(sys.argv[1])
src = p.read_text()
anchor = '        f.contents = Buffer.from(plist.build(infoPlist), "utf8");\n        cb(null, f);\n      });\n    }))'
inject = (
  '        // ERI_USAGE_DESCRIPTIONS_INJECTED\n'
  '        if (opts.darwinUsageDescriptions) {\n'
  '          for (var __k in opts.darwinUsageDescriptions) {\n'
  '            infoPlist[__k] = opts.darwinUsageDescriptions[__k];\n'
  '          }\n'
  '        }\n'
)
# Inject right before the first `f.contents = Buffer.from(plist.build(infoPlist)`
needle = '        f.contents = Buffer.from(plist.build(infoPlist), "utf8");'
idx = src.find(needle)
if idx == -1:
    raise SystemExit('[eri] FATAL: could not find plist build anchor in darwin.js')
src = src[:idx] + inject + src[idx:]
p.write_text(src)
print('[eri] darwin.js patched (usage descriptions hook installed)')
PYEOF
  else
    echo "[eri] ${GULP_ELECTRON_DARWIN} already patched, skipping"
  fi
fi

# Append darwinUsageDescriptions to the electron config that gulp consumes.
ELECTRON_CONFIG_TS="build/lib/electron.ts"
if [[ -f "${ELECTRON_CONFIG_TS}" ]] && ! grep -q "darwinUsageDescriptions" "${ELECTRON_CONFIG_TS}"; then
  echo "[eri] injecting darwinUsageDescriptions into ${ELECTRON_CONFIG_TS}"
  python3 - "${ELECTRON_CONFIG_TS}" <<'PYEOF'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
src = p.read_text()

# We append a field inside the `export const config = { ... }` object.
# Insert immediately after the line declaring `darwinIcon: ...,` for a
# stable anchor.
anchor = "\tdarwinIcon: 'resources/darwin/code.icns',\n"
addition = (
    "\tdarwinUsageDescriptions: {\n"
    "\t\tNSMicrophoneUsageDescription: 'eri uses your microphone for voice-driven coding. Audio is transcribed locally with Whisper — nothing leaves your machine.',\n"
    "\t\tNSCameraUsageDescription: 'eri uses your camera for gaze tracking. Eye landmarks are computed locally — no video is recorded or sent anywhere.',\n"
    "\t\tNSSpeechRecognitionUsageDescription: 'eri may use macOS Speech Recognition if you choose the system backend instead of local Whisper.',\n"
    "\t\tNSAppleEventsUsageDescription: 'eri may control other apps when you explicitly run a tool that does so (e.g. voice-triggered terminal launches).',\n"
    "\t\tNSDocumentsFolderUsageDescription: 'eri reads files in folders you open.',\n"
    "\t\tNSDesktopFolderUsageDescription: 'eri reads files in folders you open.',\n"
    "\t\tNSDownloadsFolderUsageDescription: 'eri reads files in folders you open.',\n"
    "\t},\n"
)
if anchor not in src:
    raise SystemExit('[eri] FATAL: could not find darwinIcon anchor in electron.ts')
src = src.replace(anchor, anchor + addition, 1)
p.write_text(src)
print('[eri] electron.ts: darwinUsageDescriptions appended')
PYEOF
fi

# ---------------------------------------------------------------------------
# 7. Custom .app + file-association + linux icons.
#    The macOS bundle uses two .icns: code.icns (app icon) and
#    code_file.icns (file-association badge). We use eri_file.icns when
#    present; otherwise reuse eri.icns for both (good enough for v0).
# ---------------------------------------------------------------------------
if [[ -f "../icons/eri.icns" ]]; then
  echo "[eri] installing custom .icns (app icon)"
  cp "../icons/eri.icns" "resources/darwin/code.icns"
  if [[ -f "../icons/eri_file.icns" ]]; then
    echo "[eri] installing custom file-association .icns"
    cp "../icons/eri_file.icns" "resources/darwin/code_file.icns"
  else
    echo "[eri] reusing eri.icns for file-association (no eri_file.icns staged)"
    cp "../icons/eri.icns" "resources/darwin/code_file.icns"
  fi
fi
if [[ -f "../icons/eri-linux-512.png" ]]; then
  echo "[eri] installing custom linux icon"
  cp "../icons/eri-linux-512.png" "resources/linux/code.png"
fi

# Audit — confirm the icon files landed.
echo "[eri] icon audit:"
ls -la resources/darwin/code.icns resources/darwin/code_file.icns resources/linux/code.png 2>&1 || true

# ---------------------------------------------------------------------------
# 7b. Bundle the Swift preview binary into eri.app/Contents/Resources/bin/.
#     Built by scripts/build_eri_preview.sh — if it's missing, build it now.
#     We run from cwd=vscode/, so ../../scripts/... reaches the repo root.
# ---------------------------------------------------------------------------
if [[ ! -x ../../scripts/eri_preview && -f ../../scripts/build_eri_preview.sh ]]; then
  echo "[eri] building eri_preview swift binary"
  bash ../../scripts/build_eri_preview.sh || echo "[eri] WARN: preview build failed, continuing"
fi
if [[ -x ../../scripts/eri_preview ]]; then
  ERI_APP_PATH="../VSCode-darwin-arm64/eri.app"
  if [[ -d "${ERI_APP_PATH}" ]]; then
    mkdir -p "${ERI_APP_PATH}/Contents/Resources/bin"
    cp ../../scripts/eri_preview "${ERI_APP_PATH}/Contents/Resources/bin/eri_preview"
    echo "[eri] bundled eri_preview binary into ${ERI_APP_PATH}/Contents/Resources/bin/"
  else
    echo "[eri] note: ${ERI_APP_PATH} not present yet — skipping preview bundle"
  fi
else
  echo "[eri] WARN: scripts/eri_preview not found — preview window unavailable in this build"
fi

# ---------------------------------------------------------------------------
# 8. Audit — dump the final product.json identity for the build log.
# ---------------------------------------------------------------------------
echo "[eri] final product.json identity:"
jq '{
  nameLong,
  applicationName,
  darwinBundleIdentifier,
  initialColorTheme,
  openToWelcomeMainPage,
  walkthroughs,
  gitHubEntitlement,
  defaultLayout,
  configurationDefaults,
  extensionAllowedProposedApi
}' product.json || true

echo "[eri] residual VS Code mentions in single-line localize() calls:"
grep -roE 'localize2?\([^)]*?(VS Code|Visual Studio Code)[^)]*?\)' src/vs 2>/dev/null \
  | grep -v "/test/" | grep -v "/sessions/" | wc -l | tr -d ' '

echo "[eri] residual brand leaks (target < 30):"
grep -roE "code\.visualstudio\.com|aka\.ms|go\.microsoft\.com|GitHub\.copilot|Visual Studio Code|VS Code" \
  src/vs product.json 2>/dev/null | wc -l
echo "[eri] product.json Copilot fields (target empty/null):"
jq -r '.defaultChatAgent, .chatExtensionId, .chatExtensionOutputId' product.json

echo "[eri] rebrand: done"
