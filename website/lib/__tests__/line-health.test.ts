import { strict as assert } from "node:assert";
import { decideAlert, type HealthState } from "../health/alert_policy";

const cfg = { failuresBeforeAlert: 2, reAlertCooldownMs: 6 * 60 * 60_000 };
const fresh: HealthState = { consecutiveFailures: 0, lastAlertAt: null };
const t0 = 1_800_000_000_000;

// Healthy → reset streak + clear the alert clock, never alerts.
{
  const d = decideAlert({ consecutiveFailures: 3, lastAlertAt: t0 }, true, t0 + 1000, cfg);
  assert.equal(d.alert, false);
  assert.equal(d.state.consecutiveFailures, 0);
  assert.equal(d.state.lastAlertAt, null);
}

// First failure → counted, but no alert yet (below threshold).
{
  const d = decideAlert(fresh, false, t0, cfg);
  assert.equal(d.alert, false);
  assert.equal(d.state.consecutiveFailures, 1);
}

// Second consecutive failure → crosses threshold → ALERT, stamps lastAlertAt.
{
  const d = decideAlert({ consecutiveFailures: 1, lastAlertAt: null }, false, t0, cfg);
  assert.equal(d.alert, true);
  assert.equal(d.state.consecutiveFailures, 2);
  assert.equal(d.state.lastAlertAt, t0);
}

// Still down within the cooldown → no re-page, but keep counting + keep the clock.
{
  const d = decideAlert({ consecutiveFailures: 2, lastAlertAt: t0 }, false, t0 + 60_000, cfg);
  assert.equal(d.alert, false);
  assert.equal(d.state.consecutiveFailures, 3);
  assert.equal(d.state.lastAlertAt, t0);
}

// Still down AFTER the cooldown → re-page, advance the clock.
{
  const later = t0 + cfg.reAlertCooldownMs + 1;
  const d = decideAlert({ consecutiveFailures: 5, lastAlertAt: t0 }, false, later, cfg);
  assert.equal(d.alert, true);
  assert.equal(d.state.lastAlertAt, later);
}

// Recovery clears the clock so a NEW outage pages promptly (after threshold).
{
  const recovered = decideAlert({ consecutiveFailures: 5, lastAlertAt: t0 }, true, t0 + 1000, cfg);
  assert.equal(recovered.state.lastAlertAt, null);
  const f1 = decideAlert(recovered.state, false, t0 + 2000, cfg);
  assert.equal(f1.alert, false); // 1st failure
  const f2 = decideAlert(f1.state, false, t0 + 3000, cfg);
  assert.equal(f2.alert, true); // 2nd → pages, not blocked by the old cooldown
}

// eslint-disable-next-line no-console
console.log("line-health.test.ts: all assertions passed");
