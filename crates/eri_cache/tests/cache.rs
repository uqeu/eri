use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use eri_cache::{Cache, CacheError, Clock, Namespace};
use serde::{Deserialize, Serialize};
use tempfile::TempDir;

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, Clone)]
struct IntentEntry {
    label: String,
    confidence: u32,
}

#[derive(Default)]
struct FakeClock {
    now: AtomicU64,
}

impl FakeClock {
    fn new(initial: u64) -> Self {
        Self {
            now: AtomicU64::new(initial),
        }
    }

    fn advance(&self, secs: u64) {
        self.now.fetch_add(secs, Ordering::SeqCst);
    }
}

impl Clock for FakeClock {
    fn now_unix(&self) -> u64 {
        self.now.load(Ordering::SeqCst)
    }
}

fn fresh_cache() -> (Cache, TempDir) {
    let dir = TempDir::new().expect("tempdir");
    let cache = Cache::open_at(&dir.path().join("cache.sled")).expect("open cache");
    (cache, dir)
}

fn fresh_cache_with_clock(clock: Arc<FakeClock>) -> (Cache, TempDir) {
    let dir = TempDir::new().expect("tempdir");
    let cache = Cache::open_with(&dir.path().join("cache.sled"), clock)
        .expect("open cache with clock");
    (cache, dir)
}

#[test]
fn set_then_get_roundtrips_a_value() {
    let (cache, _dir) = fresh_cache();
    let entry = IntentEntry {
        label: "edit_color".into(),
        confidence: 92,
    };
    cache
        .set(Namespace::IntentClassification, "make this red", &entry)
        .expect("set");
    let got: Option<IntentEntry> = cache
        .get(Namespace::IntentClassification, "make this red")
        .expect("get");
    assert_eq!(got, Some(entry));
}

#[test]
fn namespaces_are_isolated() {
    let (cache, _dir) = fresh_cache();
    cache
        .set(Namespace::IntentClassification, "key", &"intent_value")
        .expect("set intent");
    cache
        .set(Namespace::DesignPreferences, "key", &"design_value")
        .expect("set design");

    let intent: Option<String> = cache
        .get(Namespace::IntentClassification, "key")
        .expect("get intent");
    let design: Option<String> = cache
        .get(Namespace::DesignPreferences, "key")
        .expect("get design");
    let voice: Option<String> = cache
        .get(Namespace::VoiceCommandPatterns, "key")
        .expect("get voice");

    assert_eq!(intent.as_deref(), Some("intent_value"));
    assert_eq!(design.as_deref(), Some("design_value"));
    assert_eq!(voice, None);
}

#[test]
fn list_returns_keys_in_namespace_only() {
    let (cache, _dir) = fresh_cache();
    cache
        .set(Namespace::IntentClassification, "make red", &"x")
        .expect("set");
    cache
        .set(Namespace::IntentClassification, "make blue", &"x")
        .expect("set");
    cache
        .set(Namespace::DesignPreferences, "palette", &"stripe")
        .expect("set");

    let mut intent_keys = cache
        .list(Namespace::IntentClassification, None)
        .expect("list intent");
    intent_keys.sort();
    assert_eq!(intent_keys, vec!["make blue".to_string(), "make red".into()]);

    let prefixed = cache
        .list(Namespace::IntentClassification, Some("make r"))
        .expect("list prefixed");
    assert_eq!(prefixed, vec!["make red".to_string()]);

    let design_keys = cache
        .list(Namespace::DesignPreferences, None)
        .expect("list design");
    assert_eq!(design_keys, vec!["palette".to_string()]);
}

#[test]
fn ttl_expires_entries_after_simulated_time() {
    let clock = Arc::new(FakeClock::new(1_000));
    let (cache, _dir) = fresh_cache_with_clock(clock.clone());
    cache
        .set_with_ttl(
            Namespace::PromptCompression,
            "hash:abc",
            &"caveman version",
            Some(Duration::from_secs(60)),
        )
        .expect("set ttl");

    let before: Option<String> = cache
        .get(Namespace::PromptCompression, "hash:abc")
        .expect("get before expiry");
    assert_eq!(before.as_deref(), Some("caveman version"));

    clock.advance(61);

    let after: Option<String> = cache
        .get(Namespace::PromptCompression, "hash:abc")
        .expect("get after expiry");
    assert_eq!(after, None);
}

#[test]
fn purge_expired_removes_only_expired() {
    let clock = Arc::new(FakeClock::new(0));
    let (cache, _dir) = fresh_cache_with_clock(clock.clone());

    cache
        .set_with_ttl(
            Namespace::SessionRecap,
            "stale",
            &"old",
            Some(Duration::from_secs(10)),
        )
        .expect("set stale");
    cache
        .set_with_ttl(
            Namespace::SessionRecap,
            "fresh",
            &"new",
            Some(Duration::from_secs(10_000)),
        )
        .expect("set fresh");
    cache
        .set_with_ttl(Namespace::SessionRecap, "forever", &"keep", None)
        .expect("set forever");

    clock.advance(20);

    let removed = cache.purge_expired().expect("purge");
    assert_eq!(removed, 1);

    let stale: Option<String> = cache
        .get(Namespace::SessionRecap, "stale")
        .expect("get stale");
    let fresh: Option<String> = cache
        .get(Namespace::SessionRecap, "fresh")
        .expect("get fresh");
    let forever: Option<String> = cache
        .get(Namespace::SessionRecap, "forever")
        .expect("get forever");

    assert_eq!(stale, None);
    assert_eq!(fresh.as_deref(), Some("new"));
    assert_eq!(forever.as_deref(), Some("keep"));
}

#[test]
fn bad_key_with_null_byte_is_rejected() {
    let (cache, _dir) = fresh_cache();
    let err = cache
        .set(Namespace::IntentClassification, "bad\0key", &"x")
        .unwrap_err();
    assert!(matches!(err, CacheError::BadKey(_)));

    let err = cache
        .get::<String>(Namespace::IntentClassification, "bad\0key")
        .unwrap_err();
    assert!(matches!(err, CacheError::BadKey(_)));

    let err = cache
        .set(Namespace::IntentClassification, "", &"x")
        .unwrap_err();
    assert!(matches!(err, CacheError::BadKey(_)));
}

#[test]
fn cache_persists_across_reopens() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("cache.sled");
    {
        let cache = Cache::open_at(&path).expect("open 1");
        cache
            .set(Namespace::MercuryTokenSavings, "project_a", &12_400u64)
            .expect("set");
        cache.flush().expect("flush");
    }
    {
        let cache = Cache::open_at(&path).expect("open 2");
        let got: Option<u64> = cache
            .get(Namespace::MercuryTokenSavings, "project_a")
            .expect("get");
        assert_eq!(got, Some(12_400));
    }
}

#[test]
fn session_recap_entry_shape_roundtrips() {
    // Documents the canonical SessionRecap value shape so the follow-up
    // integration PR has a stable contract to target.
    #[derive(Debug, Serialize, Deserialize, PartialEq, Clone)]
    struct RecapEntry {
        intent: String,
        summary: String,
        timestamp_unix: u64,
    }
    #[derive(Debug, Serialize, Deserialize, PartialEq, Clone)]
    struct Recap {
        project: String,
        entries: Vec<RecapEntry>,
    }

    let (cache, _dir) = fresh_cache();
    let recap = Recap {
        project: "coffee_shop".into(),
        entries: vec![
            RecapEntry {
                intent: "add_hero".into(),
                summary: "Hero with espresso shot photo".into(),
                timestamp_unix: 1_700_000_000,
            },
            RecapEntry {
                intent: "add_menu".into(),
                summary: "Menu grid with prices".into(),
                timestamp_unix: 1_700_000_500,
            },
        ],
    };
    cache
        .set(Namespace::SessionRecap, "coffee_shop", &recap)
        .expect("set");
    let got: Option<Recap> = cache
        .get(Namespace::SessionRecap, "coffee_shop")
        .expect("get");
    assert_eq!(got, Some(recap));
}
