const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/**
 * Format a past timestamp (ms since epoch) as a short relative time string.
 *
 * Examples:
 *   - 0..45s        → "just now"
 *   - 46s..2m       → "1 min ago"
 *   - <60m          → "N min ago"
 *   - <24h          → "N hr ago"
 *   - <7d           → "N day(s) ago"
 *   - <30d          → "N week(s) ago"
 *   - <365d         → "N mo ago"
 *   - else          → "N yr ago"
 */
export function formatRelativeTime(timestampMs: number, nowMs: number = Date.now()): string {
  const delta = Math.max(0, nowMs - timestampMs);

  if (delta < 45 * SECOND_MS) {
    return "just now";
  }
  if (delta < MINUTE_MS) {
    return `${Math.round(delta / SECOND_MS)} sec ago`;
  }
  if (delta < HOUR_MS) {
    const minutes = Math.round(delta / MINUTE_MS);
    return `${minutes} min ago`;
  }
  if (delta < DAY_MS) {
    const hours = Math.round(delta / HOUR_MS);
    return `${hours} hr ago`;
  }
  if (delta < WEEK_MS) {
    const days = Math.round(delta / DAY_MS);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  if (delta < MONTH_MS) {
    const weeks = Math.round(delta / WEEK_MS);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }
  if (delta < YEAR_MS) {
    const months = Math.round(delta / MONTH_MS);
    return `${months} mo ago`;
  }
  const years = Math.round(delta / YEAR_MS);
  return `${years} yr ago`;
}

/**
 * Format a timestamp as a full ISO-ish local date+time string for tooltips.
 */
export function formatFullTimestamp(timestampMs: number): string {
  const d = new Date(timestampMs);
  const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
