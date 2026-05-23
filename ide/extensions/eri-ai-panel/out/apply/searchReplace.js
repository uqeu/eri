"use strict";
// JS-side preview of a SEARCH/REPLACE block applied to a buffer.
//
// This is a best-effort preview only — the canonical apply happens in the Rust
// sidecar (`eri/apply/run`). When this function returns null, the UI shows a
// "could not preview" hint and still lets the user accept the edit.
Object.defineProperty(exports, "__esModule", { value: true });
exports.applySearchReplace = applySearchReplace;
// Apply SEARCH then REPLACE to `before` returning the resulting buffer.
// Tries exact match first, then whitespace-normalized match, then trimmed lines.
// Returns null if no unambiguous match is found.
function applySearchReplace(before, search, replace) {
    if (search.length === 0) {
        return null;
    }
    const exactIndex = before.indexOf(search);
    if (exactIndex !== -1) {
        const next = before.indexOf(search, exactIndex + 1);
        if (next === -1) {
            return {
                after: before.slice(0, exactIndex) + replace + before.slice(exactIndex + search.length),
                matchKind: "exact",
                startIndex: exactIndex,
                endIndex: exactIndex + search.length,
            };
        }
        return null;
    }
    const wsOutcome = matchWhitespaceTolerant(before, search, replace);
    if (wsOutcome) {
        return wsOutcome;
    }
    return matchTrimmedLines(before, search, replace);
}
function matchWhitespaceTolerant(before, search, replace) {
    const pattern = buildWhitespacePattern(search);
    if (pattern === null) {
        return null;
    }
    const re = new RegExp(pattern, "g");
    const first = re.exec(before);
    if (!first) {
        return null;
    }
    const second = re.exec(before);
    if (second) {
        return null;
    }
    const start = first.index;
    const end = first.index + first[0].length;
    return {
        after: before.slice(0, start) + replace + before.slice(end),
        matchKind: "whitespace",
        startIndex: start,
        endIndex: end,
    };
}
function buildWhitespacePattern(search) {
    let out = "";
    let lastWasWhitespace = false;
    for (const ch of search) {
        if (/\s/.test(ch)) {
            if (!lastWasWhitespace) {
                out += "\\s+";
                lastWasWhitespace = true;
            }
            continue;
        }
        out += escapeRegex(ch);
        lastWasWhitespace = false;
    }
    return out.length === 0 ? null : out;
}
function matchTrimmedLines(before, search, replace) {
    const beforeLines = before.split("\n");
    const searchLines = search.split("\n");
    const trimmedSearch = searchLines.map((l) => l.trim());
    while (trimmedSearch.length > 0 && trimmedSearch[trimmedSearch.length - 1] === "") {
        trimmedSearch.pop();
    }
    if (trimmedSearch.length === 0) {
        return null;
    }
    let foundAt = -1;
    for (let i = 0; i <= beforeLines.length - trimmedSearch.length; i++) {
        let ok = true;
        for (let j = 0; j < trimmedSearch.length; j++) {
            if (beforeLines[i + j].trim() !== trimmedSearch[j]) {
                ok = false;
                break;
            }
        }
        if (ok) {
            if (foundAt !== -1) {
                return null;
            }
            foundAt = i;
        }
    }
    if (foundAt === -1) {
        return null;
    }
    const firstMatchedLine = beforeLines[foundAt];
    const indent = firstMatchedLine.match(/^\s*/)?.[0] ?? "";
    const replaceLines = replace.split("\n");
    const indentedReplace = replaceLines
        .map((line, idx) => (idx === 0 || line.length === 0 ? line : indent + line))
        .join("\n");
    const afterLines = [
        ...beforeLines.slice(0, foundAt),
        indentedReplace,
        ...beforeLines.slice(foundAt + trimmedSearch.length),
    ];
    const after = afterLines.join("\n");
    let startIndex = 0;
    for (let i = 0; i < foundAt; i++) {
        startIndex += beforeLines[i].length + 1;
    }
    let endIndex = startIndex;
    for (let i = 0; i < trimmedSearch.length; i++) {
        endIndex += beforeLines[foundAt + i].length + 1;
    }
    return {
        after,
        matchKind: "trimmed",
        startIndex,
        endIndex: Math.min(endIndex, before.length),
    };
}
function escapeRegex(ch) {
    return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
//# sourceMappingURL=searchReplace.js.map