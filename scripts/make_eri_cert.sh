#!/usr/bin/env bash
# Create a STABLE self-signed code-signing identity ("eri-dev") in the login
# keychain so the eri desktop app keeps the SAME signature across rebuilds.
#
# Why: macOS TCC (Screen Recording / Accessibility) keys a grant to the app's
# code-signing identity. Ad-hoc signing (`codesign --sign -`) produces a NEW
# random identity every build, so macOS treats each rebuild as a new app and
# WIPES the grant — the endless "it keeps asking for permission" loop. A single
# stable self-signed cert fixes it: grant once, persists forever.
#
# Idempotent: re-running detects an existing identity and does nothing.
set -euo pipefail

NAME="eri-dev"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
P12_PASS="eri"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if security find-identity -v -p codesigning 2>/dev/null | grep -q "$NAME"; then
  echo "✓ '$NAME' code-signing identity already present — nothing to do."
  security find-identity -v -p codesigning | grep "$NAME"
  exit 0
fi

echo "→ generating self-signed code-signing cert ($NAME)…"
# Self-signed cert with the codeSigning EKU macOS requires.
openssl req -x509 -newkey rsa:2048 -keyout "$WORK/key.pem" -out "$WORK/cert.pem" \
  -days 3650 -nodes -subj "/CN=$NAME" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" \
  -addext "basicConstraints=critical,CA:false" >/dev/null 2>&1

# -legacy: macOS Security.framework can't read the modern OpenSSL 3 PKCS12 MAC.
openssl pkcs12 -export -legacy -out "$WORK/cert.p12" \
  -inkey "$WORK/key.pem" -in "$WORK/cert.pem" \
  -passout "pass:$P12_PASS" -name "$NAME" >/dev/null 2>&1

echo "→ importing into login keychain (allow codesign to use the key)…"
# -A: let any app use the key (avoids partition-list password prompts for codesign).
security import "$WORK/cert.p12" -k "$KEYCHAIN" -P "$P12_PASS" \
  -T /usr/bin/codesign -A >/dev/null 2>&1

# CRITICAL: a freshly-imported self-signed cert is UNTRUSTED, so codesign won't
# use it and `find-identity -p codesigning` won't list it. Trust it for code
# signing (user keychain — no sudo).
echo "→ trusting the cert for code signing…"
security add-trusted-cert -p codeSign -k "$KEYCHAIN" "$WORK/cert.pem" >/dev/null 2>&1

echo
if security find-identity -v -p codesigning | grep -q "$NAME"; then
  echo "✓ SUCCESS — '$NAME' is now a usable code-signing identity:"
  security find-identity -v -p codesigning | grep "$NAME"
else
  echo "✗ import did not register the identity. Output:"
  security find-identity -v -p codesigning
  exit 1
fi
