#!/usr/bin/env bash
# Compile the eri preview Swift binary.
#
# Output: script/eri_preview (release-optimized, arm64 macOS 14+)
#
# The compiled binary is consumed by:
#   * the sidecar preview service (`eri/preview/open`), which spawns it
#   * `ide/rebrand_eri.sh`, which bundles it into eri.app/Contents/Resources/bin/
set -e
cd "$(dirname "$0")"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "[eri_preview] swiftc not found — install Xcode Command Line Tools" >&2
  exit 1
fi

TARGET="arm64-apple-macos14"

swiftc -O \
  -target "$TARGET" \
  -framework Cocoa -framework WebKit -framework Foundation \
  -o eri_preview \
  eri_preview.swift

# Best-effort ad-hoc signing so Gatekeeper doesn't prompt on launch in dev.
codesign --sign - --force --deep eri_preview 2>/dev/null || true

echo "built: $(pwd)/eri_preview ($(du -h eri_preview | cut -f1))"
