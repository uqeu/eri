// Binds account state + usage into the eri status bar item.
//
// The base statusBar.ts is a state machine (idle / listening / thinking …).
// We attach an extra item to the LEFT of the workbench items (priority 999)
// dedicated to account + tier + tokens — that way the existing item stays
// focused on runtime state and we don't fight over labels.

import * as vscode from "vscode";
import { EriSession, TIER_LABELS, UsageSummary } from "./types";
import { remainingIncludedPct } from "./usageClient";

const SIGN_IN_COMMAND = "eri.account.signIn";
const SHOW_STATUS_COMMAND = "eri.account.showStatus";

const ACCENT_YELLOW = "#F5E867";
const ACCENT_WARN = "#E5C07B";
const ACCENT_BAD = "#EF4444";
const MUTED = "#9AA4AD";

export interface RateLimitBadge {
  readonly window: string;
  /** ISO-8601 timestamp at which the throttle window resets. */
  readonly resetAt: string;
}

export interface AccountStatusBarHandle {
  setSession(session: EriSession | null): void;
  setUsage(usage: UsageSummary | null): void;
  /**
   * Set or clear the rate-limit badge. While set, the status bar shows
   * "rate-limited until 4:42pm" in red until the window rolls over.
   * Pass `null` to clear (e.g. after a successful retry).
   */
  setRateLimit(rl: RateLimitBadge | null): void;
  dispose(): void;
}

export function activateAccountStatusBar(
  context: vscode.ExtensionContext,
): AccountStatusBarHandle {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    999,
  );
  item.name = "eri account";
  context.subscriptions.push(item);

  let session: EriSession | null = null;
  let usage: UsageSummary | null = null;
  let rateLimit: RateLimitBadge | null = null;
  let rateLimitTimer: NodeJS.Timeout | undefined;

  const render = (): void => {
    // Rate-limit badge always wins — the user needs to see why their
    // last call bounced even when signed-in + within monthly budget.
    if (rateLimit) {
      item.text = `$(watch) eri · rate-limited · ${formatResetClock(rateLimit.resetAt)}`;
      item.tooltip = `Hit ${rateLimit.window} cap. Resets ${formatResetTime(rateLimit.resetAt)}.\nTerminal and Mercury still work.`;
      item.color = ACCENT_BAD;
      item.command = SHOW_STATUS_COMMAND;
      item.show();
      return;
    }
    if (!session) {
      item.text = "$(sparkle) eri · sign in to use";
      item.tooltip = "Sign in to eri to enable hosted models.";
      item.color = MUTED;
      item.command = SIGN_IN_COMMAND;
      item.show();
      return;
    }
    const tierLabel = TIER_LABELS[session.tier];
    if (!usage) {
      item.text = `$(sparkle) eri · ${tierLabel}`;
      item.tooltip = buildSignedInTooltip(session, null);
      item.color = ACCENT_YELLOW;
      item.command = SHOW_STATUS_COMMAND;
      item.show();
      return;
    }
    const pct = remainingIncludedPct(usage);
    const color = pct < 10 ? ACCENT_BAD : pct < 25 ? ACCENT_WARN : ACCENT_YELLOW;
    item.text = `$(sparkle) eri · ${tierLabel} · ${Math.round(pct)}% left`;
    item.tooltip = buildSignedInTooltip(session, usage);
    item.color = color;
    item.command = SHOW_STATUS_COMMAND;
    item.show();
  };

  const clearRateLimitTimer = (): void => {
    if (rateLimitTimer) {
      clearTimeout(rateLimitTimer);
      rateLimitTimer = undefined;
    }
  };

  render();

  return {
    setSession(next: EriSession | null): void {
      session = next;
      render();
    },
    setUsage(next: UsageSummary | null): void {
      usage = next;
      render();
    },
    setRateLimit(next: RateLimitBadge | null): void {
      clearRateLimitTimer();
      rateLimit = next;
      if (next) {
        const target = Date.parse(next.resetAt);
        if (Number.isFinite(target)) {
          const delay = Math.max(1_000, target - Date.now());
          // Refresh clock label every 30s + clear when reset passes.
          rateLimitTimer = setTimeout(() => {
            rateLimit = null;
            render();
          }, delay);
        }
      }
      render();
    },
    dispose(): void {
      clearRateLimitTimer();
      item.dispose();
    },
  };
}

function formatResetClock(iso: string): string {
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return "soon";
  const deltaMs = target - Date.now();
  if (deltaMs <= 0) return "now";
  const totalSec = Math.ceil(deltaMs / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.ceil(totalSec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h${remMin}m` : `${hr}h`;
}

function formatResetTime(iso: string): string {
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return "soon";
  const d = new Date(target);
  // 4:42pm-style local time.
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildSignedInTooltip(
  session: EriSession,
  usage: UsageSummary | null,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.isTrusted = false;
  md.appendMarkdown(`**eri** — ${TIER_LABELS[session.tier]}\n\n`);
  md.appendMarkdown(`Signed in as \`${session.email}\`\n\n`);
  if (usage) {
    md.appendMarkdown(`Used: ${fmt(usage.tokensUsed)} / ${fmt(usage.tokensIncluded)} included\n\n`);
    md.appendMarkdown(`Ghost zone left: ${fmt(usage.remainingGhost)}\n\n`);
    if (usage.softCapWarning) {
      md.appendMarkdown(`_Soft cap reached — using ghost-zone tokens._\n\n`);
    }
  }
  md.appendMarkdown("Click to open account & usage.");
  return md;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}
