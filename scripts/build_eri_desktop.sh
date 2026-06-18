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
ID="${ERI_SIGN_ID:-eri-dev}"

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

echo "built + signed ($ID): $APP"
codesign -dv "$APP" 2>&1 | grep -i authority | head -1 || true
