"use strict";
// Auto-group resolver: given a new terminal's cwd, decide which existing
// group it joins (nearest-ancestor cwd) or create a new auto-group named
// after the last path segment.
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCwd = normalizeCwd;
exports.isDescendantOf = isDescendantOf;
exports.findNearestGroup = findNearestGroup;
exports.autoGroupNameFromCwd = autoGroupNameFromCwd;
exports.resolveAutoGroup = resolveAutoGroup;
const path = require("node:path");
const state_1 = require("./state");
// Normalize a path for prefix comparison. Strips trailing separators.
function normalizeCwd(cwd) {
    if (!cwd) {
        return "";
    }
    const normalized = path.normalize(cwd);
    if (normalized === path.sep) {
        return normalized;
    }
    return normalized.replace(/[\\/]+$/, "");
}
// Is `child` the same as or a descendant of `parent`?
function isDescendantOf(child, parent) {
    const c = normalizeCwd(child);
    const p = normalizeCwd(parent);
    if (!c || !p) {
        return false;
    }
    if (c === p) {
        return true;
    }
    const prefix = p.endsWith(path.sep) ? p : `${p}${path.sep}`;
    return c.startsWith(prefix);
}
// Walks the snapshot's groups looking for the most specific (deepest cwd)
// ancestor of `cwd`. Returns undefined if no group's cwd is an ancestor.
function findNearestGroup(snapshot, cwd) {
    const normalized = normalizeCwd(cwd);
    if (!normalized) {
        return undefined;
    }
    let best;
    for (const group of snapshot.groups) {
        if (!group.cwd) {
            continue;
        }
        if (!isDescendantOf(normalized, group.cwd)) {
            continue;
        }
        if (!best || (group.cwd && best.cwd && group.cwd.length > best.cwd.length)) {
            best = group;
        }
    }
    return best;
}
// Pick a reasonable name from a cwd — the last non-empty path segment.
// Falls back to "shell" if the cwd is empty or root.
function autoGroupNameFromCwd(cwd) {
    const normalized = normalizeCwd(cwd);
    if (!normalized) {
        return "shell";
    }
    const base = path.basename(normalized);
    if (!base || base === normalized) {
        return base || "shell";
    }
    return base;
}
// Resolves the auto-group for a given cwd, creating a new group if needed.
// Returns the resulting snapshot + groupId. Pure: caller decides when to
// commit.
function resolveAutoGroup(snapshot, cwd) {
    const existing = findNearestGroup(snapshot, cwd);
    if (existing) {
        return { snapshot, groupId: existing.id, created: false };
    }
    const normalized = normalizeCwd(cwd);
    const group = {
        id: (0, state_1.generateGroupId)(),
        name: autoGroupNameFromCwd(cwd),
        expanded: true,
        auto: true,
        cwd: normalized || undefined,
        createdAtMs: Date.now(),
    };
    return {
        snapshot: (0, state_1.addGroup)(snapshot, group),
        groupId: group.id,
        created: true,
    };
}
//# sourceMappingURL=cwdGrouping.js.map