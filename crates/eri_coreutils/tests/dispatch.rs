//! End-to-end smoke tests for the JSON-RPC dispatcher.
//!
//! These drive `dispatch()` directly with synthesised `Request` values and a
//! tempdir workspace — no stdio plumbing, no real extension, just the same
//! function the binary calls.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::sync::Mutex;

use eri_coreutils::{dispatch, Request, Services, SharedTierState, TierState};

fn make_state() -> (SharedTierState, Arc<Services>) {
    let tier = Arc::new(Mutex::new(TierState {
        tier: "free".into(),
        features: HashSet::new(),
    }));
    (tier, Services::new())
}

fn req(method: &str, params: Value) -> Request {
    Request {
        jsonrpc: "2.0".to_string(),
        id: Some(json!(1)),
        method: method.to_string(),
        params,
    }
}

fn write_at(path: &Path, body: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, body).unwrap();
}

fn write_rel(root: &Path, rel: &str, body: &str) {
    write_at(&root.join(rel), body);
}

#[tokio::test]
async fn ping_returns_pong() {
    let (tier, services) = make_state();
    let request = req("eri/ping", json!({}));
    let result = dispatch(&request, &tier, &services).await.unwrap();
    assert_eq!(result, json!({ "pong": true }));
}

#[tokio::test]
async fn rules_list_returns_loaded_rules() {
    let tmp = TempDir::new().unwrap();
    let ws = tmp.path();
    write_at(
        &ws.join(".eri/rules/style.mdc"),
        "---\nname: style\nmode: always\npriority: 7\ndescription: \"House style\"\n---\nBe terse.\n",
    );

    let (tier, services) = make_state();
    let request = req("eri/rules/list", json!({ "workspace": ws }));
    let result = dispatch(&request, &tier, &services).await.unwrap();

    let rules = result["rules"].as_array().expect("rules array");
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0]["name"], "style");
    assert_eq!(rules[0]["mode"], "always");
    assert_eq!(rules[0]["priority"], 7);
    assert_eq!(rules[0]["description"], "House style");
    assert!(rules[0]["bodyPreview"]
        .as_str()
        .unwrap()
        .contains("Be terse."));
}

#[tokio::test]
async fn apply_parse_and_run_creates_file() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path().to_path_buf();
    let text = concat!(
        "Some preamble.\n",
        "<<<<<<< SEARCH new.txt\n",
        "=======\n",
        "hello there\n",
        ">>>>>>> REPLACE\n",
        "Some postamble.\n",
    );

    let (tier, services) = make_state();
    let request = req(
        "eri/apply/parse_and_run",
        json!({ "root": root, "text": text }),
    );
    let result = dispatch(&request, &tier, &services).await.unwrap();
    let applied = result["applied"].as_array().unwrap();
    assert_eq!(applied.len(), 1);
    assert_eq!(applied[0]["kind"], "created");
    let body = std::fs::read_to_string(root.join("new.txt")).unwrap();
    assert!(body.contains("hello there"));
}

#[tokio::test]
async fn checkpoints_create_and_list() {
    let tmp = TempDir::new().unwrap();
    let ws = tmp.path().to_path_buf();
    eri_git::ensure_git_repo(&ws).expect("init repo");
    // Need at least one tracked file for the working tree to be meaningful.
    write_rel(&ws, "seed.txt", "seed\n");

    let (tier, services) = make_state();

    let create = dispatch(
        &req(
            "eri/checkpoints/create",
            json!({ "workspace": ws, "label": "before edit" }),
        ),
        &tier,
        &services,
    )
    .await
    .unwrap();
    let id = create["id"].as_str().expect("id").to_string();
    assert!(create["sha"].as_str().unwrap().len() >= 7);
    assert_eq!(create["label"], "before edit");

    let listed = dispatch(
        &req("eri/checkpoints/list", json!({ "workspace": ws })),
        &tier,
        &services,
    )
    .await
    .unwrap();
    let items = listed["checkpoints"].as_array().unwrap();
    assert!(items.iter().any(|c| c["id"] == id));
}

#[tokio::test]
async fn web_search_stub_returns_note() {
    let (tier, services) = make_state();
    let request = req("eri/web/search", json!({ "query": "rust" }));
    let result = dispatch(&request, &tier, &services).await.unwrap();
    assert_eq!(result["results"].as_array().unwrap().len(), 0);
    assert!(result["note"]
        .as_str()
        .unwrap()
        .contains("Web search not yet wired"));
}

#[tokio::test]
async fn index_methods_are_feature_gated() {
    let (tier, services) = make_state();
    let tmp = TempDir::new().unwrap();
    let ws: PathBuf = tmp.path().to_path_buf();
    let request = req("eri/index/stats", json!({ "workspace": ws }));
    let err = dispatch(&request, &tier, &services)
        .await
        .expect_err("should be feature locked");
    let rpc = err.into_rpc_error();
    assert_eq!(rpc.code, eri_coreutils::FEATURE_LOCKED_CODE);
    assert!(rpc.message.contains("mcp"));
}
