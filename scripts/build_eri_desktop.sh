#!/usr/bin/env bash
# Build + bundle + STABLY sign the eri desktop app.
#
# CRITICAL: sign with the stable `eri-dev` identity, NEVER ad-hoc (`--sign -`).
# Ad-hoc signatures change every build, which makes macOS TCC treat each rebuild
# as a brand-new app and WIPE the Screen-Recording / Accessibility grant — that
# was the "permission keeps asking" loop. A stable identity makes the grant
# persist across rebuilds. (Pluely uses Developer ID for the same reason; this is
# the free self-signed equivalent. Create it once with scripts/make_eri_cert.sh.)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/apps/Eri.app"

# Ensure the stable eri-dev identity exists (idempotent), then resolve it to a
# HASH. Signing by hash (not the "eri-dev" name) is unambiguous even if stray
# same-named certs linger in the keychain — the name-based form fails with
# "ambiguous (matches eri-dev and eri-dev)".
"$ROOT/scripts/make_eri_cert.sh"
ID="${ERI_SIGN_ID:-$(security find-identity -v -p codesigning | awk '/eri-dev/{print $2; exit}')}"
if [ -z "$ID" ]; then echo "✗ no eri-dev signing identity; run scripts/make_eri_cert.sh" >&2; exit 1; fi

cd "$ROOT/apps/eri-desktop/src-tauri"
cargo build
cp target/debug/eri-desktop "$APP/Contents/MacOS/eri-desktop"
# Bundle the helpers INSIDE the app so they share the app's TCC identity.
cp "$ROOT/target/eri_control_server" "$APP/Contents/MacOS/eri_control_server" 2>/dev/null || true
cp "$ROOT/target/eri_voice_server" "$APP/Contents/MacOS/eri_voice_server" 2>/dev/null || true

# Stable signing (inner binaries first, then seal the bundle).
codesign --force --sign "$ID" "$APP/Contents/MacOS/eri_control_server" 2>/dev/null || true
codesign --force --sign "$ID" "$APP/Contents/MacOS/eri_voice_server" 2>/dev/null || true
codesign --force --deep --sign "$ID" "$APP"

echo "built + signed ($ID = eri-dev): $APP"
codesign -dv "$APP" 2>&1 | grep -i authority | head -1 || true
codesign --verify --deep --strict "$APP" && echo "signature valid ✓"
