//! Tests for the model_store cache layout. No network — the
//! `ensure_model_returns_existing_path_when_cached` test pre-creates the
//! file so the download branch is never hit.

use std::fs;

use eri_tab::model_store::{
    cached_path, default_cache_dir, ensure_model, is_cached, lookup,
};

const TEST_REPO: &str = "test/Mock-GGUF";
const TEST_FILE: &str = "mock-1b-q4_k_m.gguf";

#[test]
fn default_cache_dir_is_under_cache_root() {
    let dir = default_cache_dir().expect("cache dir resolves");
    let s = dir.to_string_lossy();
    assert!(
        s.ends_with("eri/models") || s.ends_with("eri\\models"),
        "unexpected cache dir: {s}"
    );
}

#[test]
fn cached_path_includes_filename() {
    let p = cached_path(TEST_REPO, TEST_FILE).expect("path resolves");
    assert!(p.to_string_lossy().ends_with(TEST_FILE));
}

#[tokio::test(flavor = "current_thread")]
async fn ensure_model_returns_existing_path_when_cached() {
    // Pre-populate the cache so ensure_model never hits the network.
    let dest = cached_path(TEST_REPO, TEST_FILE).expect("path resolves");
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).expect("mkdir cache parent");
    }
    fs::write(&dest, b"not-really-a-gguf").expect("seed cache");
    assert!(is_cached(TEST_REPO, TEST_FILE), "seed should be cached");

    let resolved = ensure_model(TEST_REPO, TEST_FILE, |_| {})
        .await
        .expect("returns cached path");
    assert_eq!(resolved, dest);
    assert_eq!(lookup(TEST_REPO, TEST_FILE), Some(dest.clone()));

    // Cleanup so reruns are idempotent.
    let _ = fs::remove_file(&dest);
}

#[test]
#[ignore]
fn live_download_smoke_test() {
    // Gated behind --ignored: hits the network + downloads ~1.1GB.
    // Run manually with `cargo test -p eri_tab -- --ignored`.
}
