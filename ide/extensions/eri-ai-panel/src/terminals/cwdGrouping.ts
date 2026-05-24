// Auto-group resolver: given a new terminal's cwd, decide which existing
// group it joins (nearest-ancestor cwd) or create a new auto-group named
// after the last path segment.

import * as path from "node:path";
import {
  GroupRecord,
  StateSnapshot,
  addGroup,
  generateGroupId,
} from "./state";

export interface AutoGroupOutcome {
  readonly snapshot: StateSnapshot;
  readonly groupId: string;
  readonly created: boolean;
}

// Normalize a path for prefix comparison. Strips trailing separators.
export function normalizeCwd(cwd: string): string {
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
export function isDescendantOf(child: string, parent: string): boolean {
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
export function findNearestGroup(
  snapshot: StateSnapshot,
  cwd: string,
): GroupRecord | undefined {
  const normalized = normalizeCwd(cwd);
  if (!normalized) {
    return undefined;
  }
  let best: GroupRecord | undefined;
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
export function autoGroupNameFromCwd(cwd: string): string {
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
export function resolveAutoGroup(
  snapshot: StateSnapshot,
  cwd: string,
): AutoGroupOutcome {
  const existing = findNearestGroup(snapshot, cwd);
  if (existing) {
    return { snapshot, groupId: existing.id, created: false };
  }
  const normalized = normalizeCwd(cwd);
  const group: GroupRecord = {
    id: generateGroupId(),
    name: autoGroupNameFromCwd(cwd),
    expanded: true,
    auto: true,
    cwd: normalized || undefined,
    createdAtMs: Date.now(),
  };
  return {
    snapshot: addGroup(snapshot, group),
    groupId: group.id,
    created: true,
  };
}
