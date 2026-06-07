#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/scripts/eri_agent_manager.swift"
CONTROL_SRC="$ROOT/scripts/eri_control_server.swift"
CONTROL_OUT="$ROOT/target/eri_control_server"
APP="$ROOT/apps/Eri Agent Manager.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
OUT="$MACOS/eri_agent_manager"
CACHE="$ROOT/.cache/swift-module-cache"

mkdir -p "$CACHE" "$MACOS"
export CLANG_MODULE_CACHE_PATH="$CACHE"

# Author Info.plist every build so the privacy-usage strings can never be lost.
# (Missing NSSpeechRecognitionUsageDescription / NSMicrophoneUsageDescription / NSCameraUsageDescription
#  causes macOS to hard-crash the app the moment voice or gaze is used.)
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>eri_agent_manager</string>
  <key>CFBundleIdentifier</key><string>dev.eri.agent-manager</string>
  <key>CFBundleName</key><string>Eri</string>
  <key>CFBundleDisplayName</key><string>Eri</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>Eri uses your microphone for voice commands.</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>Eri transcribes your speech on-device to drive the agent.</string>
  <key>NSCameraUsageDescription</key><string>Eri uses the camera for gaze tracking.</string>
  <key>NSAppleEventsUsageDescription</key><string>Eri controls other apps on your behalf when you ask it to (open, quit, and operate apps hands-free).</string>
</dict>
</plist>
PLIST

swiftc \
  -O \
  -module-cache-path "$CACHE" \
  -target arm64-apple-macos14 \
  -framework Cocoa \
  -framework WebKit \
  -framework Foundation \
  -o "$OUT" \
  "$SRC"

# Build the computer-control actuation server (loopback HTTP → AX/CGEvent).
# The app spawns this and points ERI_CONTROL_ENDPOINT at it for `eri control --live`.
mkdir -p "$ROOT/target"
swiftc \
  -O \
  -module-cache-path "$CACHE" \
  -target arm64-apple-macos14 \
  -o "$CONTROL_OUT" \
  "$CONTROL_SRC"
codesign --force --sign - "$CONTROL_OUT" >/dev/null 2>&1 || true

# Sign the binary first, then seal the whole bundle (so the plist keys are covered).
codesign --force --sign - "$OUT" >/dev/null 2>&1 || true
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "$APP"
