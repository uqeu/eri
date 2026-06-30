/**
 * Line liveness — so eri never goes silently dark again (it was down ~2 days and
 * nothing told us). The dedicated line runs on the Vercel WEBHOOK, so liveness is
 * about the webhook's health, not a worker process.
 *
 * ACTIVE probe (not a passive "no inbound in N hours", which can't tell a quiet
 * line from a broken one): a fresh Spectrum init exercises the Photon token
 * exchange — the EXACT thing that broke the line. If that succeeds the webhook
 * could serve a real delivery; if it throws, the line is dark.
 *
 * Run from the imessage cron (~every 10 min). `decideAlert` is the pure, tested
 * anti-spam policy: alert only after K consecutive failures, and re-alert at most
 * once per cooldown while still down — so the page is trusted, not muted.
 */

import {
  decideAlert,
  FAILURES_BEFORE_ALERT,
  RE_ALERT_COOLDOWN_MS,
  type HealthState,
} from "@/lib/health/alert_policy";
import { sql } from "@/lib/db";
import { sendOpsAlertEmail } from "@/lib/email";
import { getSpectrumApp, resetSpectrumApp } from "@/lib/messaging/spectrum";

/**
 * Active health probe: a fresh Spectrum app init runs the Photon token exchange.
 * Best-effort + never throws — any failure (bad creds, suspended line, network)
 * reads as "down". Resets the memoized app first so we test CURRENT auth, not a
 * cached one (safe: the cron is its own serverless instance, distinct from the
 * webhook's).
 */
export async function probeSpectrumHealthy(): Promise<boolean> {
  try {
    resetSpectrumApp();
    await getSpectrumApp();
    return true;
  } catch {
    return false;
  }
}

/**
 * One liveness pass: probe → load state → decide → (maybe) page → persist. Never
 * throws; meant to be called best-effort from the cron.
 */
export async function runLineHealthCheck(nowMs: number = Date.now()): Promise<{
  healthy: boolean;
  alerted: boolean;
}> {
  const healthy = await probeSpectrumHealthy();
  try {
    const rows = await sql()<{ consecutive_failures: number; last_alert_at: Date | string | null }[]>`
      SELECT consecutive_failures, last_alert_at FROM line_health WHERE id = 1
    `;
    const prev: HealthState = {
      consecutiveFailures: rows[0]?.consecutive_failures ?? 0,
      lastAlertAt: rows[0]?.last_alert_at ? new Date(rows[0].last_alert_at).getTime() : null,
    };
    const decision = decideAlert(prev, healthy, nowMs, {
      failuresBeforeAlert: FAILURES_BEFORE_ALERT,
      reAlertCooldownMs: RE_ALERT_COOLDOWN_MS,
    });

    if (decision.alert) {
      await sendOpsAlertEmail({
        to: process.env.ERI_ALERT_EMAIL ?? "khai@tryeri.ca",
        subject: "⚠️ eri iMessage line looks DOWN",
        body:
          `The active health probe (Spectrum/Photon init) failed ` +
          `${decision.state.consecutiveFailures}x in a row — the iMessage line may be dark.\n\n` +
          `Check: Vercel logs for /api/v1/spectrum/inbound (spectrum.app_init_failed?), ` +
          `and the Photon business-line creds (PHOTON_PROJECT_ID/SECRET).\n\n` +
          `Time: ${new Date(nowMs).toISOString()}`,
      });
    }

    const lastAlertIso = decision.state.lastAlertAt ? new Date(decision.state.lastAlertAt).toISOString() : null;
    await sql()`
      UPDATE line_health SET
        consecutive_failures = ${decision.state.consecutiveFailures},
        last_check_at = now(),
        last_ok_at = CASE WHEN ${healthy} THEN now() ELSE last_ok_at END,
        last_alert_at = ${lastAlertIso}
      WHERE id = 1
    `;
    return { healthy, alerted: decision.alert };
  } catch (e) {
    console.error("line_health.check_failed", e instanceof Error ? e.message : e);
    return { healthy, alerted: false };
  }
}
