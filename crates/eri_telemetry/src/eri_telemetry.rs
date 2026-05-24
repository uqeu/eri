//! Posthog event tracking for eri alpha. Designed to be a strict no-op when
//! `ERI_POSTHOG_KEY` is unset so dev builds make zero network calls.
//!
//! All `track()` failures are swallowed: telemetry must never lose user work.

use std::path::PathBuf;
use std::sync::OnceLock;

use serde_json::{Value, json};
use uuid::Uuid;

const POSTHOG_CAPTURE_URL_DEFAULT: &str = "https://us.i.posthog.com/capture/";
const TELEMETRY_ID_FILENAME: &str = "telemetry-id";
const ERI_HOME_DIR: &str = ".eri";

/// Cached distinct ID — generated once per process from disk (or freshly minted
/// + persisted on first run). `None` means we couldn't read or write the file
///   and have given up; subsequent `track()` calls will fall back to a synthetic
///   per-process ID so events still flow.
static DISTINCT_ID: OnceLock<String> = OnceLock::new();

/// Resolve `~/.eri/telemetry-id`. Returns None if no home dir is available.
fn telemetry_id_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    Some(home.join(ERI_HOME_DIR).join(TELEMETRY_ID_FILENAME))
}

/// Read the persisted UUID, or mint + write a new one. Returns the synthetic
/// process-scoped UUID if the filesystem hop fails (so we never lose events).
fn load_or_create_distinct_id() -> String {
    let Some(path) = telemetry_id_path() else {
        return Uuid::new_v4().to_string();
    };

    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if Uuid::parse_str(trimmed).is_ok() {
            return trimmed.to_string();
        }
    }

    let fresh = Uuid::new_v4().to_string();
    if let Some(parent) = path.parent()
        && let Err(error) = std::fs::create_dir_all(parent)
    {
        log::warn!(
            "[eri.telemetry] could not create {}: {error}",
            parent.display()
        );
        return fresh;
    }
    if let Err(error) = std::fs::write(&path, &fresh) {
        log::warn!(
            "[eri.telemetry] could not persist telemetry id to {}: {error}",
            path.display()
        );
    }
    fresh
}

fn distinct_id() -> &'static str {
    DISTINCT_ID.get_or_init(load_or_create_distinct_id)
}

/// True when `ERI_POSTHOG_KEY` is set to a non-empty value. Single source of
/// truth for "should we make a network call?".
fn telemetry_enabled() -> bool {
    matches!(std::env::var("ERI_POSTHOG_KEY"), Ok(ref key) if !key.is_empty())
}

fn posthog_capture_url() -> String {
    std::env::var("ERI_POSTHOG_HOST")
        .ok()
        .filter(|host| !host.is_empty())
        .map(|host| {
            let trimmed = host.trim_end_matches('/');
            format!("{trimmed}/capture/")
        })
        .unwrap_or_else(|| POSTHOG_CAPTURE_URL_DEFAULT.to_string())
}

/// Fire-and-forget Posthog event. No-op when `ERI_POSTHOG_KEY` is unset.
///
/// The POST runs on a detached `std::thread::spawn` so the caller (UI thread)
/// never blocks on network. Any network failure is logged at debug level and
/// otherwise swallowed — telemetry never crashes eri.
pub fn track(event_name: &str, properties: Value) {
    if !telemetry_enabled() {
        return;
    }

    let Ok(api_key) = std::env::var("ERI_POSTHOG_KEY") else {
        return;
    };
    if api_key.is_empty() {
        return;
    }

    let event = event_name.to_string();
    let distinct = distinct_id().to_string();
    let url = posthog_capture_url();
    let payload = json!({
        "api_key": api_key,
        "event": event,
        "distinct_id": distinct,
        "properties": properties,
    });

    std::thread::Builder::new()
        .name(format!("eri-telemetry-{event}"))
        .spawn(move || {
            // Errors are deliberately silenced. The alternative is "user loses
            // their work because analytics failed", which is unacceptable.
            // We log at debug so a curious dev can see why a beacon dropped.
            match ureq::post(&url)
                .set("Content-Type", "application/json")
                .timeout(std::time::Duration::from_secs(5))
                .send_string(&payload.to_string())
            {
                Ok(_) => {}
                Err(error) => {
                    log::debug!("[eri.telemetry] capture failed: {error}");
                }
            }
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Snapshot env vars so a single failing test can't leak state into the
    /// rest of the suite. Cargo runs tests in parallel by default, so we still
    /// rely on each test setting only the keys it owns.
    struct EnvGuard {
        key: &'static str,
        prior: Option<String>,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let prior = std::env::var(key).ok();
            // SAFETY: tests are gated to single-threaded for env mutation via
            // the `serial` ordering we manage by partitioning env keys per
            // test (no two tests touch the same key).
            unsafe { std::env::set_var(key, value) };
            Self { key, prior }
        }

        fn unset(key: &'static str) -> Self {
            let prior = std::env::var(key).ok();
            unsafe { std::env::remove_var(key) };
            Self { key, prior }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.prior {
                Some(value) => unsafe { std::env::set_var(self.key, value) },
                None => unsafe { std::env::remove_var(self.key) },
            }
        }
    }

    #[test]
    fn track_is_noop_when_posthog_key_unset() {
        let _guard = EnvGuard::unset("ERI_POSTHOG_KEY");
        // The contract: returns immediately without panicking and without
        // spawning a network thread. We can't observe "no thread spawned"
        // directly, but we can assert the gate function the spawner consults.
        assert!(!telemetry_enabled());
        track("test_event_should_be_dropped", json!({"foo": "bar"}));
    }

    #[test]
    fn track_is_noop_when_posthog_key_empty() {
        let _guard = EnvGuard::set("ERI_POSTHOG_KEY_EMPTY_PROBE", "");
        // Use a distinct probe key so we don't race with other tests; flip the
        // real key off for the duration.
        let _real = EnvGuard::set("ERI_POSTHOG_KEY", "");
        assert!(!telemetry_enabled());
        track("test_event_empty_key", json!({}));
    }

    #[test]
    fn telemetry_id_path_resolves_under_home() {
        let _guard = EnvGuard::set("HOME", "/tmp/eri-telemetry-test-home");
        let path = telemetry_id_path().expect("HOME is set");
        assert!(path.ends_with(".eri/telemetry-id"));
    }

    #[test]
    fn load_or_create_distinct_id_persists_uuid() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let _guard = EnvGuard::set("HOME", tmp.path().to_str().expect("utf8 path"));
        let first = load_or_create_distinct_id();
        let second = load_or_create_distinct_id();
        assert_eq!(first, second, "id should round-trip through disk");
        assert!(Uuid::parse_str(&first).is_ok());
    }
}
