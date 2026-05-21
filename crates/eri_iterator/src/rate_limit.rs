//! Per-user rate limiting and cost tracking for the Discord and Slack bots.
//!
//! Both bots are unauthenticated public surfaces: a Discord channel where the
//! bot is installed lets anyone with the channel @-mention us, and Slack slash
//! commands fire from any workspace member. Every fire costs real money (the
//! Mercury 2 API bill is on us). Without per-user caps a single bad actor
//! could rack up the wallet bill overnight.
//!
//! The limiter keeps three orthogonal caps per user id:
//!   1. **Cooldown** — minimum delay between consecutive successful requests.
//!   2. **Daily count** — max successful builds per rolling 24h window.
//!   3. **Daily $$** — max accumulated cost (USD) per rolling 24h window.
//!
//! The cost cap is evaluated *before* a request fires using a caller-supplied
//! estimate; once the build completes the caller reports the actual cost via
//! [`RateLimiter::record`]. That keeps a runaway prompt from busting the cap
//! mid-build, while ensuring counters reflect what was really spent.

use std::collections::HashMap;
use std::env;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Default minimum gap between successive requests from the same user.
pub const DEFAULT_PER_USER_COOLDOWN_SECONDS: u64 = 60;
/// Default cap on successful builds per user per rolling 24h window.
pub const DEFAULT_PER_USER_DAILY_LIMIT: u32 = 20;
/// Default cap on accumulated USD spend per user per rolling 24h window.
pub const DEFAULT_PER_USER_DAILY_USD_LIMIT: f64 = 1.00;

const DAY: Duration = Duration::from_secs(60 * 60 * 24);

const ENV_COOLDOWN: &str = "ERI_BOT_PER_USER_COOLDOWN";
const ENV_DAILY: &str = "ERI_BOT_PER_USER_DAILY";
const ENV_DAILY_USD: &str = "ERI_BOT_PER_USER_USD";

/// Outcome of a [`RateLimiter::check`] call. When `allow` is false the caller
/// should refuse the request and surface `reason` to the user. `retry_after_seconds`
/// is the smallest wait that would change the answer — zero for the daily caps
/// (since they require waiting until the rolling window resets) is replaced
/// with the seconds until the day rollover so the caller can still tell the
/// user "try again in N seconds" instead of just "blocked".
#[derive(Clone, Debug, PartialEq)]
pub struct Decision {
    pub allow: bool,
    pub retry_after_seconds: u64,
    pub reason: String,
}

impl Decision {
    fn allow() -> Self {
        Self {
            allow: true,
            retry_after_seconds: 0,
            reason: String::new(),
        }
    }

    fn deny(retry_after: Duration, reason: impl Into<String>) -> Self {
        // Round up: a user told "retry in 0s" while we still gate them is
        // worse than telling them to wait 1s.
        let secs = retry_after.as_secs().max(if retry_after.is_zero() { 0 } else { 1 });
        Self {
            allow: false,
            retry_after_seconds: secs,
            reason: reason.into(),
        }
    }
}

#[derive(Clone, Debug)]
struct UserState {
    last_request_at: Option<Instant>,
    builds_today: u32,
    usd_today: f64,
    day_started: Instant,
}

impl UserState {
    fn new(now: Instant) -> Self {
        Self {
            last_request_at: None,
            builds_today: 0,
            usd_today: 0.0,
            day_started: now,
        }
    }

    fn maybe_reset_day(&mut self, now: Instant) {
        if now.saturating_duration_since(self.day_started) >= DAY {
            self.builds_today = 0;
            self.usd_today = 0.0;
            self.day_started = now;
        }
    }
}

/// Per-user rate limiter shared between bot adapters. Cheap to clone via `Arc`
/// at the bot's call site; the internal state is `Mutex<HashMap>` so it is
/// `Send + Sync` and safe to share across tokio tasks.
#[derive(Debug)]
pub struct RateLimiter {
    per_user_cooldown: Duration,
    per_user_daily_limit: u32,
    per_user_daily_usd_limit: f64,
    state: Mutex<HashMap<String, UserState>>,
}

impl RateLimiter {
    pub fn new(
        per_user_cooldown: Duration,
        per_user_daily_limit: u32,
        per_user_daily_usd_limit: f64,
    ) -> Self {
        Self {
            per_user_cooldown,
            per_user_daily_limit,
            per_user_daily_usd_limit,
            state: Mutex::new(HashMap::new()),
        }
    }

    /// Build a limiter from `ERI_BOT_PER_USER_COOLDOWN` (seconds, integer),
    /// `ERI_BOT_PER_USER_DAILY` (count), `ERI_BOT_PER_USER_USD` (float USD).
    /// Unset or unparseable values fall back to the `DEFAULT_*` constants so
    /// a bot can boot even with a misconfigured environment.
    pub fn from_env() -> Self {
        let cooldown_secs = env::var(ENV_COOLDOWN)
            .ok()
            .and_then(|raw| raw.trim().parse::<u64>().ok())
            .unwrap_or(DEFAULT_PER_USER_COOLDOWN_SECONDS);
        let daily = env::var(ENV_DAILY)
            .ok()
            .and_then(|raw| raw.trim().parse::<u32>().ok())
            .unwrap_or(DEFAULT_PER_USER_DAILY_LIMIT);
        let daily_usd = env::var(ENV_DAILY_USD)
            .ok()
            .and_then(|raw| raw.trim().parse::<f64>().ok())
            .filter(|v| v.is_finite() && *v >= 0.0)
            .unwrap_or(DEFAULT_PER_USER_DAILY_USD_LIMIT);
        Self::new(Duration::from_secs(cooldown_secs), daily, daily_usd)
    }

    pub fn per_user_cooldown(&self) -> Duration {
        self.per_user_cooldown
    }

    pub fn per_user_daily_limit(&self) -> u32 {
        self.per_user_daily_limit
    }

    pub fn per_user_daily_usd_limit(&self) -> f64 {
        self.per_user_daily_usd_limit
    }

    /// Decide whether `user_id` may make a request whose worst-case cost is
    /// `est_cost_usd`. The check is read-mostly: it does not increment any
    /// counters. Callers must call [`Self::record`] when the request succeeds.
    pub fn check(&self, user_id: &str, est_cost_usd: f64) -> Decision {
        self.check_at(user_id, est_cost_usd, Instant::now())
    }

    /// Record the *actual* cost of a successful request. Callers should invoke
    /// this after the build completes, using the Mercury usage event.
    pub fn record(&self, user_id: &str, actual_cost_usd: f64) {
        self.record_at(user_id, actual_cost_usd, Instant::now());
    }

    /// Testing hook: same as [`Self::check`] but with an explicit clock value.
    /// Lets integration tests assert window-boundary behaviour without
    /// sleeping for real time.
    #[doc(hidden)]
    pub fn check_at(&self, user_id: &str, est_cost_usd: f64, now: Instant) -> Decision {
        let mut guard = match self.state.lock() {
            Ok(guard) => guard,
            // A poisoned mutex means a previous holder panicked. Recover by
            // adopting the inner state so the bot keeps running rather than
            // wedging every user permanently.
            Err(poisoned) => poisoned.into_inner(),
        };
        let entry = guard
            .entry(user_id.to_string())
            .or_insert_with(|| UserState::new(now));
        entry.maybe_reset_day(now);

        if let Some(last) = entry.last_request_at {
            let elapsed = now.saturating_duration_since(last);
            if elapsed < self.per_user_cooldown {
                let wait = self.per_user_cooldown - elapsed;
                return Decision::deny(
                    wait,
                    format!(
                        "Slow down — retry in {}s",
                        wait.as_secs().max(1)
                    ),
                );
            }
        }

        if entry.builds_today >= self.per_user_daily_limit {
            let wait = DAY.saturating_sub(now.saturating_duration_since(entry.day_started));
            return Decision::deny(wait, "Daily limit hit — try tomorrow");
        }

        let est = est_cost_usd.max(0.0);
        if entry.usd_today + est > self.per_user_daily_usd_limit {
            let wait = DAY.saturating_sub(now.saturating_duration_since(entry.day_started));
            return Decision::deny(wait, "Daily spend limit hit — try tomorrow");
        }

        Decision::allow()
    }

    /// Testing hook: same as [`Self::record`] but with an explicit clock value.
    #[doc(hidden)]
    pub fn record_at(&self, user_id: &str, actual_cost_usd: f64, now: Instant) {
        let mut guard = match self.state.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let entry = guard
            .entry(user_id.to_string())
            .or_insert_with(|| UserState::new(now));
        entry.maybe_reset_day(now);
        entry.last_request_at = Some(now);
        entry.builds_today = entry.builds_today.saturating_add(1);
        let cost = actual_cost_usd.max(0.0);
        // Treat NaN as zero — we never want NaN to permanently poison the
        // accumulator and lock out a user.
        if cost.is_finite() {
            entry.usd_today += cost;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed_limiter() -> RateLimiter {
        RateLimiter::new(Duration::from_secs(60), 20, 1.00)
    }

    #[test]
    fn defaults_match_documented_constants() {
        let limiter = RateLimiter::new(
            Duration::from_secs(DEFAULT_PER_USER_COOLDOWN_SECONDS),
            DEFAULT_PER_USER_DAILY_LIMIT,
            DEFAULT_PER_USER_DAILY_USD_LIMIT,
        );
        assert_eq!(limiter.per_user_cooldown(), Duration::from_secs(60));
        assert_eq!(limiter.per_user_daily_limit(), 20);
        assert!((limiter.per_user_daily_usd_limit() - 1.0).abs() < 1e-9);
    }

    #[test]
    fn first_request_is_allowed() {
        let limiter = fixed_limiter();
        let decision = limiter.check("u1", 0.01);
        assert!(decision.allow);
    }

    #[test]
    fn record_updates_internal_state() {
        let limiter = fixed_limiter();
        let now = Instant::now();
        let _ = limiter.check_at("u1", 0.01, now);
        limiter.record_at("u1", 0.05, now);
        let guard = limiter.state.lock().unwrap();
        let state = guard.get("u1").expect("user state present");
        assert_eq!(state.builds_today, 1);
        assert!((state.usd_today - 0.05).abs() < 1e-9);
    }
}
