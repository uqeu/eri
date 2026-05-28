"use strict";
// Pure glob matcher shared with the janitor-rules watcher. Lives in
// its own file so it can be unit-tested without pulling the `vscode`
// module (which isn't available outside the extension host).
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchesSaveGlob = matchesSaveGlob;
/**
 * Matches a `save:<glob>` trigger against a relative file path.
 * Returns false for any non-save trigger so unsupported kinds never
 * fire.
 *
 * Glob semantics (mirrors the sidecar's matcher):
 *   - `**` matches any sequence including `/`
 *   - `*` matches any sequence within a single path segment
 *   - `?` matches exactly one non-slash character
 *
 * Patterns are tiny and never security-sensitive — we roll our own
 * instead of pulling minimatch / picomatch.
 */
function matchesSaveGlob(trigger, relpath) {
    if (!trigger.startsWith("save:"))
        return false;
    return globMatch(trigger.slice("save:".length), relpath);
}
function globMatch(pattern, input) {
    return matchesAt(pattern, 0, input, 0);
}
function matchesAt(pat, pi, input, ii) {
    if (pi >= pat.length)
        return ii >= input.length;
    if (pat.startsWith("**", pi)) {
        const next = pat.charCodeAt(pi + 2) === 47 ? pi + 3 : pi + 2;
        for (let advance = 0; advance <= input.length - ii; advance++) {
            if (matchesAt(pat, next, input, ii + advance))
                return true;
        }
        return false;
    }
    if (pat[pi] === "*") {
        for (let advance = 0; advance <= input.length - ii; advance++) {
            if (advance > 0 && input[ii + advance - 1] === "/")
                return false;
            if (matchesAt(pat, pi + 1, input, ii + advance))
                return true;
        }
        return false;
    }
    if (pat[pi] === "?") {
        if (ii >= input.length || input[ii] === "/")
            return false;
        return matchesAt(pat, pi + 1, input, ii + 1);
    }
    if (ii < input.length && pat[pi] === input[ii]) {
        return matchesAt(pat, pi + 1, input, ii + 1);
    }
    return false;
}
//# sourceMappingURL=saveGlob.js.map