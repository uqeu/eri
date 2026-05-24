#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/vscode"

echo "[eri-nuke] starting aggressive Microsoft/VS Code sweep in $(pwd)"

# 1. Sweep .ts files — only inside localize() calls and string literals (NOT identifiers)
#    Copyright headers (bare // comments) are untouched because the regex requires localize(...)
find src extensions -type f -name "*.ts" \
  ! -path "*/test/*" ! -name "*.test.ts" ! -path "*/node_modules/*" \
  -print0 2>/dev/null | xargs -0 perl -i -pe '
    # Replace inside localize() calls
    s/(localize\([^)]*?["\047][^"\047]*?)Microsoft Visual Studio Code(.*?["\047])/$1eri$2/g;
    s/(localize\([^)]*?["\047][^"\047]*?)Visual Studio Code(.*?["\047])/$1eri$2/g;
    s/(localize\([^)]*?["\047][^"\047]*?)\bVS Code\b(.*?["\047])/$1eri$2/g;
    s/(localize\([^)]*?["\047][^"\047]*?)\bMicrosoft Corporation\b(.*?["\047])/$1eri$2/g;
    # Replace "Microsoft <UI noun>" with "eri <noun>"
    s/(localize\([^)]*?["\047][^"\047]*?)\bMicrosoft (Authentication|Marketplace|Privacy Statement|Terms of Service|Online Services|Account)([^"\047]*?["\047])/$1eri $2$3/g;
    # Catch-all: any remaining "Microsoft" inside localize() strings → "eri"
    s/(localize\([^)]*?["\047][^"\047]*?)\bMicrosoft\b([^"\047]*?["\047])/$1eri$2/g;
  ' 2>/dev/null || echo "[eri-nuke] WARN: some .ts files skipped"

# 2. .nls.json files (compiled message catalogs)
find src extensions -type f -name "*.nls.json" ! -path "*/node_modules/*" -print0 2>/dev/null | \
  xargs -0 perl -i -pe '
    s/"([^"]*)Microsoft Visual Studio Code([^"]*)"/"$1eri$2"/g;
    s/"([^"]*)Visual Studio Code([^"]*)"/"$1eri$2"/g;
    s/"([^"]*)\bVS Code\b([^"]*)"/"$1eri$2"/g;
    s/"([^"]*)\bMicrosoft Corporation\b([^"]*)"/"$1eri$2"/g;
    s/"([^"]*)\bMicrosoft\b([^"]*)"/"$1eri$2"/g;
  ' 2>/dev/null || echo "[eri-nuke] WARN: some .nls.json files skipped"

# 3. product.json descriptions
if [[ -f product.json ]]; then
  perl -i -pe '
    s/Microsoft Visual Studio Code/eri/g;
    s/Visual Studio Code/eri/g;
    s/\bVS Code\b/eri/g;
    s/\bMicrosoft Corporation\b/eri/g;
    s/\bMicrosoft\b/eri/g;
  ' product.json
fi

# 4. package.json description in built-in extensions (leave publisher ids alone)
find extensions -maxdepth 3 -name "package.json" ! -path "*/node_modules/*" -print0 2>/dev/null | \
  xargs -0 perl -i -pe '
    s/("description":\s*"[^"]*?)(?:Microsoft Visual Studio Code|Visual Studio Code|VS Code)([^"]*?")/$1eri$2/g;
    s/("description":\s*"[^"]*?)\bMicrosoft\b([^"]*?")/$1eri$2/g;
  ' 2>/dev/null || echo "[eri-nuke] WARN: some package.json files skipped"

# 5. Welcome page alt-text strings (not inside localize() — separate sweep)
ALT_FILE="src/vs/workbench/contrib/welcomeGettingStarted/common/gettingStartedContent.ts"
if [[ -f "$ALT_FILE" ]]; then
  perl -i -pe '
    s/\bVS Code Copilot multi file edits\b/eri multi-file edits/g;
    s/\bVS Code Settings\b/eri Settings/g;
    s/\bVS Code extension marketplace\b/eri extensions marketplace/g;
  ' "$ALT_FILE"
fi

# Audit
echo "[eri-nuke] === Audit ==="
echo -n "[eri-nuke] Residual VS Code mentions in localize() calls (src/vs): "
grep -roE 'localize\([^)]*?(VS Code|Visual Studio Code)[^)]*?\)' src/vs 2>/dev/null | wc -l
echo -n "[eri-nuke] Residual Microsoft mentions in localize() calls (src/vs): "
grep -roE 'localize\([^)]*?Microsoft[^)]*?\)' src/vs 2>/dev/null | wc -l
echo -n "[eri-nuke] Residual VS Code in nls.json (src/vs): "
grep -rh "Visual Studio Code\|VS Code" src/vs --include="*.nls.json" 2>/dev/null | wc -l
echo -n "[eri-nuke] Residual Microsoft in nls.json (src/vs): "
grep -rh "Microsoft" src/vs --include="*.nls.json" 2>/dev/null | wc -l
echo "[eri-nuke] done"
