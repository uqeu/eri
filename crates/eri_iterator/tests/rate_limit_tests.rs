use std::time::{Duration, Instant};

use eri_iterator::RateLimiter;

#[test]
fn cooldown_blocks_repeat_request_within_window() {
    let limiter = RateLimiter::new(Duration::from_secs(60), 100, 100.0);
    let t0 = Instant::now();

    let first = limiter.check_at("user-a", 0.01, t0);
    assert!(first.allow, "first request should be allowed");
    limiter.record_at("user-a", 0.05, t0);

    // 30s into the 60s cooldown — must be blocked.
    let mid = t0 + Duration::from_secs(30);
    let second = limiter.check_at("user-a", 0.01, mid);
    assert!(!second.allow, "second request inside cooldown must be denied");
    assert!(second.retry_after_seconds > 0);
    assert!(
        second.reason.contains("Slow down"),
        "deny reason should reflect cooldown, got `{}`",
        second.reason
    );
}

#[test]
fn cooldown_clears_after_window() {
    let limiter = RateLimiter::new(Duration::from_secs(60), 100, 100.0);
    let t0 = Instant::now();
    limiter.record_at("user-b", 0.05, t0);

    // 61s later the cooldown has elapsed — request should be allowed.
    let later = t0 + Duration::from_secs(61);
    let decision = limiter.check_at("user-b", 0.01, later);
    assert!(decision.allow, "request after cooldown must be allowed");
    assert_eq!(decision.retry_after_seconds, 0);
}

#[test]
fn daily_count_limit_blocks_after_threshold() {
    let limiter = RateLimiter::new(Duration::from_secs(0), 3, 100.0);
    let t0 = Instant::now();

    for index in 0..3 {
        // Stagger fake time slightly so each successive check is allowed when
        // there's any cooldown. Cooldown is zero here, but using a stable
        // monotonic offset makes the test resilient if defaults change.
        let now = t0 + Duration::from_millis(index * 10);
        let decision = limiter.check_at("user-c", 0.01, now);
        assert!(decision.allow, "build #{index} should be allowed");
        limiter.record_at("user-c", 0.01, now);
    }

    let after = t0 + Duration::from_secs(1);
    let denied = limiter.check_at("user-c", 0.01, after);
    assert!(!denied.allow, "4th build in 24h must be denied");
    assert!(
        denied.reason.contains("Daily limit hit"),
        "deny reason should reflect daily count cap, got `{}`",
        denied.reason
    );
    assert!(denied.retry_after_seconds > 0);
}

#[test]
fn daily_usd_limit_blocks_after_threshold() {
    let limiter = RateLimiter::new(Duration::from_secs(0), 100, 1.00);
    let t0 = Instant::now();

    // Spend $0.90 across three builds.
    for index in 0..3 {
        let now = t0 + Duration::from_millis(index * 10);
        let decision = limiter.check_at("user-d", 0.30, now);
        assert!(decision.allow);
        limiter.record_at("user-d", 0.30, now);
    }

    // Next request estimates another $0.30 — pushing past $1.00 cap.
    let after = t0 + Duration::from_secs(1);
    let denied = limiter.check_at("user-d", 0.30, after);
    assert!(!denied.allow, "spend past USD cap must be denied");
    assert!(
        denied.reason.contains("Daily spend limit hit"),
        "deny reason should reflect USD cap, got `{}`",
        denied.reason
    );
}

#[test]
fn day_resets_after_24h() {
    let limiter = RateLimiter::new(Duration::from_secs(0), 2, 1.00);
    let t0 = Instant::now();

    // Burn through both daily slots.
    for index in 0..2 {
        let now = t0 + Duration::from_millis(index * 10);
        let decision = limiter.check_at("user-e", 0.40, now);
        assert!(decision.allow);
        limiter.record_at("user-e", 0.40, now);
    }
    let blocked = limiter.check_at("user-e", 0.01, t0 + Duration::from_secs(60));
    assert!(!blocked.allow, "user should be blocked after hitting daily count");

    // Jump past the 24h rolling window — counters reset and the next request
    // should be allowed again.
    let next_day = t0 + Duration::from_secs(60 * 60 * 24 + 1);
    let allowed = limiter.check_at("user-e", 0.40, next_day);
    assert!(
        allowed.allow,
        "request after 24h window should be allowed (got reason `{}`)",
        allowed.reason
    );
}
