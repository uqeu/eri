/**
 * Anti-spam alert policy for the line liveness alarm — SDK-free so it's unit-
 * testable without loading the Spectrum client. Pure.
 *
 * Alert only after K consecutive failures, and re-alert at most once per cooldown
 * while still down — so the page stays trusted, not muted. Recovery clears the
 * clock so a fresh outage pages promptly.
 */

/** Don't page on a single transient blip; require this many in a row. */
export const FAILURES_BEFORE_ALERT = 2;
/** While still down, don't re-page more often than this. */
export const RE_ALERT_COOLDOWN_MS = 6 * 60 * 60_000; // 6h

export interface HealthState {
  consecutiveFailures: number;
  /** Epoch ms of the last alert sent, or null. */
  lastAlertAt: number | null;
}
export interface AlertConfig {
  failuresBeforeAlert: number;
  reAlertCooldownMs: number;
}
export interface AlertDecision {
  alert: boolean;
  /** The state to persist after this check. */
  state: HealthState;
}

export function decideAlert(
  prev: HealthState,
  healthy: boolean,
  nowMs: number,
  cfg: AlertConfig,
): AlertDecision {
  if (healthy) {
    return { alert: false, state: { consecutiveFailures: 0, lastAlertAt: null } };
  }
  const consecutiveFailures = prev.consecutiveFailures + 1;
  const reachedThreshold = consecutiveFailures >= cfg.failuresBeforeAlert;
  const cooledDown = prev.lastAlertAt === null || nowMs - prev.lastAlertAt >= cfg.reAlertCooldownMs;
  const alert = reachedThreshold && cooledDown;
  return {
    alert,
    state: { consecutiveFailures, lastAlertAt: alert ? nowMs : prev.lastAlertAt },
  };
}
