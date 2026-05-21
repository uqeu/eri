/**
 * Display helpers shared by the forum UI. Kept in `lib/` so both the server
 * components in `app/forum/` and the client form components can import them
 * without crossing the server-only boundary.
 */

export function formatHandle(email: string): string {
  const at = email.indexOf("@");
  if (at === -1) return email;
  return email.slice(0, at);
}

export function formatRelativeTime(epochMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - epochMs);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

export function previewLine(body: string, max = 140): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}
