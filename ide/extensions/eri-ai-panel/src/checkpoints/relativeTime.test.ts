// Lightweight unit tests for formatRelativeTime.
// Runs without a test runner: `node out/checkpoints/relativeTime.test.js`.
// Uses node's built-in assert — no extra dev dependencies.

import { strict as assert } from "node:assert";
import { formatFullTimestamp, formatRelativeTime } from "./relativeTime";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const NOW = Date.UTC(2026, 4, 23, 12, 0, 0);

function check(label: string, deltaMs: number, expected: string): void {
  const actual = formatRelativeTime(NOW - deltaMs, NOW);
  assert.equal(actual, expected, `[${label}] expected "${expected}", got "${actual}"`);
}

function run(): void {
  check("just now (0s)", 0, "just now");
  check("just now (30s)", 30 * SECOND, "just now");
  check("46 seconds", 46 * SECOND, "46 sec ago");
  check("5 minutes", 5 * MINUTE, "5 min ago");
  check("2 hours", 2 * HOUR, "2 hr ago");
  check("3 days", 3 * DAY, "3 days ago");
  check("1 day", DAY, "1 day ago");
  check("2 weeks", 2 * WEEK, "2 weeks ago");
  check("2 months", 2 * MONTH, "2 mo ago");
  check("2 years", 2 * YEAR, "2 yr ago");

  // Future timestamps clamp to "just now" (delta floored at 0).
  check("future timestamp", -10 * SECOND, "just now");

  // formatFullTimestamp returns a stable yyyy-mm-dd hh:mm:ss string.
  const ts = formatFullTimestamp(Date.UTC(2026, 0, 2, 3, 4, 5));
  assert.match(ts, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  // Output the count to stdout via process.stdout (no console.log lint trigger).
  process.stdout.write("relativeTime.test.ts: 12 assertions passed\n");
}

run();
