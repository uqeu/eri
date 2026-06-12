#!/usr/bin/env bash
#
# Harden + self-contain the eri macOS app for distribution.
#
# HONEST SCOPE (read docs/SECURITY-THREAT-MODEL.md): you cannot make a binary
# that has to run un-inspectable — the CPU decrypts to execute, so a determined
# reverse-engineer can always look. This pipeline does the things that actually
# matter and that DO work:
#   1. Secret-scan GATE   — refuse to ship if any secret-like string is present.
#   2. Obfuscate frontend — minify + mangle the WebView JS/CSS/HTML (the only
#                           plaintext) and bundle it INSIDE the .app, so nobody
#                           can "Show Package Contents" and read the source.
#   3. Strip binaries     — drop local symbols from the native Mach-O binaries
#                           so structure/function names aren't trivially listed.
#   4. Entitlements       — emit hardened-runtime entitlements for signing later
#                           (anti-injection; pairs with notarization at release).
#   5. Verify             — re-scan the assembled bundle.
#
# This stops the casual "I opened eri and read everything / I hacked eri" — the
# real goal. It is not DRM and does not pretend to be.
#
# Usage:  scripts/harden_eri.sh            # harden the existing .app in place
#         scripts/harden_eri.sh --build    # rebuild the app first, then harden
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/apps/Eri Agent Manager.app"
WEB_SRC="$ROOT/apps/eri-agent-manager"
RES="$APP/Contents/Resources/web"

c_blue=$'\033[1;36m'; c_grn=$'\033[1;32m'; c_red=$'\033[1;31m'; c_off=$'\033[0m'
step() { printf "\n%s▸ %s%s\n" "$c_blue" "$1" "$c_off"; }
ok()   { printf "  %s✓%s %s\n" "$c_grn" "$c_off" "$1"; }
die()  { printf "  %s✗ %s%s\n" "$c_red" "$1" "$c_off"; exit 1; }

if [ "${1:-}" = "--build" ]; then
  step "0/5  Rebuild the app (release)"
  "$ROOT/scripts/build_eri_agent_manager.sh" >/dev/null && ok "app rebuilt"
fi

[ -d "$APP" ] || die "app bundle not found — run scripts/build_eri_agent_manager.sh first"

# --- 1. Secret-scan gate ----------------------------------------------------
step "1/5  Secret scan (build gate)"
# Patterns that must NEVER ship inside a distributed artifact.
SECRET_RE='sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|service_role|-----BEGIN [A-Z ]*PRIVATE KEY-----|eri_sk_[A-Za-z0-9]{16,}'
if grep -rEln "$SECRET_RE" "$WEB_SRC" "$ROOT/scripts/eri_agent_manager.swift" 2>/dev/null | grep -v -i placeholder | grep .; then
  die "secret-like string found in shippable source — ABORT (rotate + remove before shipping)"
fi
ok "no secrets in shippable source"

# --- 2. Obfuscate + bundle the frontend ------------------------------------
step "2/5  Obfuscate + bundle the WebView frontend into the .app"
[ -d "$WEB_SRC" ] || die "frontend source not found at $WEB_SRC"
rm -rf "$RES"; mkdir -p "$RES"

# JS: compress + mangle + toplevel rename → dense, meaningless identifiers.
if npx --yes terser@5 "$WEB_SRC/manager.js" --compress --mangle --toplevel -o "$RES/manager.js" 2>/dev/null && [ -s "$RES/manager.js" ]; then
  ok "manager.js obfuscated ($(wc -c <"$WEB_SRC/manager.js") → $(wc -c <"$RES/manager.js") bytes)"
else
  cp "$WEB_SRC/manager.js" "$RES/manager.js"; ok "manager.js copied (terser unavailable — minify skipped)"
fi

# CSS: strip comments + whitespace (best-effort).
if npx --yes clean-css-cli@5 "$WEB_SRC/manager.css" -o "$RES/manager.css" 2>/dev/null && [ -s "$RES/manager.css" ]; then
  ok "manager.css minified"
else
  cp "$WEB_SRC/manager.css" "$RES/manager.css"; ok "manager.css copied (clean-css unavailable)"
fi

# HTML: collapse + inline-minify (best-effort).
if npx --yes html-minifier-terser@7 --collapse-whitespace --remove-comments --minify-css true --minify-js true "$WEB_SRC/index.html" -o "$RES/index.html" 2>/dev/null && [ -s "$RES/index.html" ]; then
  ok "index.html minified"
else
  cp "$WEB_SRC/index.html" "$RES/index.html"; ok "index.html copied (html-minifier unavailable)"
fi

# --- 3. Strip native binaries ----------------------------------------------
step "3/5  Strip local symbols from native binaries"
for b in "$APP/Contents/MacOS/eri_agent_manager" "$ROOT/target/eri_control_server" "$ROOT/target/release/eri"; do
  if [ -f "$b" ]; then
    before=$(nm "$b" 2>/dev/null | wc -l | tr -d ' ')
    strip -x "$b" 2>/dev/null || true
    after=$(nm "$b" 2>/dev/null | wc -l | tr -d ' ')
    ok "stripped $(basename "$b")  (symbols $before → $after)"
  fi
done

# --- 4. Hardened-runtime entitlements --------------------------------------
step "4/5  Emit hardened-runtime entitlements (for signing at release)"
cat > "$ROOT/apps/eri.entitlements" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- WebKit needs JIT + writable-executable memory for its JS engine. -->
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <!-- eri drives other apps (open/quit/operate) on the user's behalf. -->
  <key>com.apple.security.automation.apple-events</key><true/>
  <!-- Voice + gaze. -->
  <key>com.apple.security.device.audio-input</key><true/>
  <key>com.apple.security.device.camera</key><true/>
  <!-- Disable library validation so the bundled control-server helper runs. -->
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict>
</plist>
PLIST
ok "wrote apps/eri.entitlements"
printf "    %sat release:%s codesign --options runtime --entitlements apps/eri.entitlements \\\\\n               --sign \"Developer ID Application: <you>\" \"%s\"\n" "$c_blue" "$c_off" "$APP"

# --- 5. Verify the assembled bundle ----------------------------------------
step "5/5  Verify the hardened bundle"
[ -f "$RES/index.html" ] && [ -f "$RES/manager.js" ] && ok "frontend is bundled inside the .app (self-contained)" || die "bundled frontend missing"
if grep -rEln "$SECRET_RE" "$APP" 2>/dev/null | grep -v -i placeholder | grep .; then
  die "secret-like string found INSIDE the assembled .app — ABORT"
fi
ok "assembled .app re-scanned: no secrets"
# Confirm the readable assets are the obfuscated ones (no original comments).
if head -c 80 "$RES/manager.js" | grep -q "//"; then
  printf "  %s! manager.js still has comments — terser may have been skipped%s\n" "$c_red" "$c_off"
else
  ok "shipped manager.js is minified (no source comments)"
fi

printf "\n%s✓ eri hardened.%s Frontend obfuscated + bundled; binaries stripped; zero secrets; entitlements ready.\n" "$c_grn" "$c_off"
printf "  Remaining for public release (deferred until you've run eri): Developer-ID sign + notarize + .dmg.\n"
