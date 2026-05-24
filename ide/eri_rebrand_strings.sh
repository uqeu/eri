#!/usr/bin/env bash
# eri_rebrand_strings.sh — sweep user-visible "VS Code" / "Visual Studio Code"
# strings from the prepared vscode/ source tree, replacing them with "eri".
#
# Idempotent and safe to re-run. Operates ONLY on string literals inside
# localize(...) calls (the canonical VS Code i18n entry point) plus a few
# narrow extras (product.json descriptions, *.nls.json catalogs if present).
#
# Designed to be called from rebrand_eri.sh, or invoked directly:
#     bash ide/eri_rebrand_strings.sh
#
# Constraints:
#   - never touches identifier names containing "vscode"
#   - never rewrites `from '...vscode...'` / `import '...vscode...'`
#   - leaves `Microsoft Corporation` copyright headers intact
#   - skips tests (they don't ship)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VSCODE_DIR="${SCRIPT_DIR}/vscode"

if [[ ! -d "${VSCODE_DIR}/src/vs" ]]; then
  echo "[eri-strings] FATAL: ${VSCODE_DIR}/src/vs not found"
  exit 1
fi

cd "${VSCODE_DIR}"

echo "[eri-strings] sweeping localize() strings under src/vs/ (excluding tests, sessions/)"

# Collect target files. Skip:
#   - tests (don't ship)
#   - src/vs/sessions/ (eri's own panel imports from here; internal)
TARGETS=()
while IFS= read -r -d '' f; do
  TARGETS+=("$f")
done < <(find src/vs -type f -name "*.ts" \
  ! -path "*/test/*" \
  ! -name "*.test.ts" \
  ! -path "src/vs/sessions/*" \
  -print0)

echo "[eri-strings] candidate files: ${#TARGETS[@]}"

# Perl script: replaces inside localize(...) calls only.
# Strategy: match `localize(` ... up to the closing `)` allowing nested
# strings and escapes, then inside that span replace "Visual Studio Code"
# and "VS Code" (word-bounded) with "eri". We use a multi-line slurp
# (-0777) so localize() calls spanning multiple lines are caught.
PERL_SWEEP='
use strict;
use warnings;

local $/ = undef;
my $src = <>;
my $orig = $src;

# Replace within localize(...) and localize2(...) calls.
# Greedy-but-bounded: we scan until the matching close paren at depth 0,
# treating quoted strings opaquely. To keep this tractable in regex, we
# rely on the fact that VS Code localize() calls do not contain raw
# unbalanced parens inside their string literals.
$src =~ s{
    \b(localize2?)\(           # localize( or localize2(
    (                          # group 2: arg list up to matching )
      (?:
        "(?:\\.|[^"\\])*"      #   double-quoted string
        | \x27(?:\\.|[^\x27\\])*\x27  # single-quoted string
        | `(?:\\.|[^`\\])*`    #   backtick string
        | [^()"\x27`]+         #   anything else except parens/quotes
        | \( (?: (?> [^()]+ ) | (?2) )* \)  # balanced parens (recursive)
      )*
    )
    \)
}{
    my $name = $1;
    my $args = $2;
    # Rewrite inside string literals only — protect against rewriting
    # identifiers like comments (none expected in arg list, but safe).
    $args =~ s/\bVisual\s+Studio\s+Code\b/eri/g;
    $args =~ s/\bVS\s+Code\b/eri/g;
    $args =~ s/\bVSCodium\b/eri/g;
    $args =~ s{https?://code\.visualstudio\.com}{https://eri.dev}g;
    $args =~ s|code\.visualstudio\.com|eri.dev|g;
    $args =~ s|aka\.ms|eri.dev/docs|g;
    $args =~ s|go\.microsoft\.com/fwlink|eri.dev/help|g;
    "$name($args)";
}gsex;

print $src if $src ne $orig;
exit($src eq $orig ? 1 : 0);  # exit 0 = changed, 1 = no change
'

CHANGED=0
for f in "${TARGETS[@]}"; do
  if grep -qE "Visual Studio Code|VS Code|VSCodium|code\.visualstudio\.com" "$f" 2>/dev/null; then
    OUTPUT=$(perl -e "$PERL_SWEEP" "$f" 2>/dev/null || true)
    if [[ -n "$OUTPUT" ]]; then
      printf '%s' "$OUTPUT" > "$f"
      CHANGED=$((CHANGED + 1))
    fi
  fi
done

echo "[eri-strings] files modified: ${CHANGED}"

# ---------------------------------------------------------------------------
# product.json — replace user-visible descriptions but NOT the field keys.
# Field "label": "VS Code" in particular (a workspace-trust label, etc.)
# ---------------------------------------------------------------------------
if [[ -f product.json ]]; then
  echo "[eri-strings] sweeping product.json descriptions"
  perl -i -pe '
    s/\bVisual\s+Studio\s+Code\b/eri/g;
    s/\bVS\s+Code\b/eri/g;
    s/\bVSCodium\b/eri/g;
    s{https?://code\.visualstudio\.com}{https://eri.dev}g;
    s|code\.visualstudio\.com|eri.dev|g;
    s|aka\.ms|eri.dev/docs|g;
    s|go\.microsoft\.com/fwlink|eri.dev/help|g;
  ' product.json
fi

# ---------------------------------------------------------------------------
# *.nls.json catalogs (only present in prepared/built trees, not source).
# ---------------------------------------------------------------------------
NLS_FILES=$(find src/vs -name "*.nls.json" 2>/dev/null || true)
if [[ -n "${NLS_FILES}" ]]; then
  echo "[eri-strings] sweeping nls.json catalogs"
  for j in ${NLS_FILES}; do
    perl -i -pe '
      s/\bVisual\s+Studio\s+Code\b/eri/g;
      s/\bVS\s+Code\b/eri/g;
      s/\bVSCodium\b/eri/g;
      s|code\.visualstudio\.com|eri.dev|g;
      s|aka\.ms|eri.dev/docs|g;
      s|go\.microsoft\.com/fwlink|eri.dev/help|g;
    ' "$j"
  done
fi

# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------
RESIDUAL=$(grep -roE 'localize2?\([^)]*?(VS Code|Visual Studio Code)[^)]*?\)' src/vs 2>/dev/null \
  | grep -v "/test/" \
  | grep -v "/sessions/" \
  | wc -l | tr -d ' ')

echo "[eri-strings] residual VS Code mentions in single-line localize() calls: ${RESIDUAL}"

# Broader residual: any VS Code mention anywhere in shippable code
BROAD=$(grep -roE "(Visual Studio Code|VS Code)" src/vs --include="*.ts" 2>/dev/null \
  | grep -v "/test/" \
  | grep -v "/sessions/" \
  | grep -v "\.test\.ts:" \
  | wc -l | tr -d ' ')
echo "[eri-strings] broad residual (including comments/identifiers): ${BROAD}"

echo "[eri-strings] done"
