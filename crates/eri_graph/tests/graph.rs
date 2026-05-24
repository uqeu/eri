//! Integration tests for the eri_graph crate.
//!
//! These tests exercise the public surface (open, insert, traverse, query)
//! and the auto-instrumentation helpers. They use either tempdirs or the
//! in-memory open() so they don't touch the developer's actual workspace.

use std::thread;
use std::time::Duration;

use serde_json::json;
use tempfile::TempDir;

use eri_graph::{auto, edge_kind, node_kind, Direction, Edge, Graph, Node};

#[test]
fn open_creates_schema_in_tempdir() {
    let dir = TempDir::new().unwrap();
    let graph = Graph::open(dir.path()).unwrap();
    // Inserting a node verifies the schema is in place.
    let id = graph
        .insert_node(Node::new("prompt", json!({ "text": "hello" })))
        .unwrap();
    assert!(!id.is_empty());
    assert!(dir.path().join(".eri").join("graph.sqlite").exists());
}

#[test]
fn insert_node_and_edge_then_read_back() {
    let graph = Graph::open_in_memory().unwrap();
    let a = graph
        .insert_node(Node::new("prompt", json!({ "text": "build me a button" })))
        .unwrap();
    let b = graph
        .insert_node(Node::new("intent", json!({ "label": "build" })))
        .unwrap();

    let edge = Edge::new(b.clone(), a.clone(), edge_kind::CAUSED_BY);
    let edge_id = graph.insert_edge(edge).unwrap();
    assert!(!edge_id.is_empty());

    let node = graph.get_node(&a).unwrap().unwrap();
    assert_eq!(node.kind, "prompt");
    assert_eq!(
        node.body.get("text").and_then(|v| v.as_str()),
        Some("build me a button")
    );

    let neighbors = graph
        .neighbors(&a, None, Direction::In)
        .unwrap();
    // Two in-edges: belongs_to_session and caused_by from `b`.
    assert!(neighbors.iter().any(|(e, _)| e.kind == "caused_by"));
}

#[test]
fn neighbors_respects_direction_filter() {
    let graph = Graph::open_in_memory().unwrap();
    let a = graph
        .insert_node(Node::new("prompt", json!({ "text": "x" })))
        .unwrap();
    let b = graph
        .insert_node(Node::new("intent", json!({ "label": "iterate" })))
        .unwrap();
    graph
        .insert_edge(Edge::new(b.clone(), a.clone(), edge_kind::CAUSED_BY))
        .unwrap();

    // From `a`: only in-edges from b carry caused_by (b -> a).
    let out_only = graph
        .neighbors(&a, Some(edge_kind::CAUSED_BY), Direction::Out)
        .unwrap();
    assert!(out_only.is_empty());

    let in_only = graph
        .neighbors(&a, Some(edge_kind::CAUSED_BY), Direction::In)
        .unwrap();
    assert_eq!(in_only.len(), 1);
    assert_eq!(in_only[0].1.id, b);

    let both = graph
        .neighbors(&a, Some(edge_kind::CAUSED_BY), Direction::Both)
        .unwrap();
    assert_eq!(both.len(), 1);
}

#[test]
fn traverse_respects_depth_and_edge_kind() {
    let graph = Graph::open_in_memory().unwrap();
    let p = graph
        .insert_node(Node::new("prompt", json!({ "text": "p" })))
        .unwrap();
    let i = graph
        .insert_node(Node::new("intent", json!({ "label": "i" })))
        .unwrap();
    let m = graph
        .insert_node(Node::new("model_call", json!({ "model": "x" })))
        .unwrap();
    let r = graph
        .insert_node(Node::new("model_response", json!({ "text": "r" })))
        .unwrap();

    graph
        .insert_edge(Edge::new(i.clone(), p.clone(), edge_kind::CAUSED_BY))
        .unwrap();
    graph
        .insert_edge(Edge::new(m.clone(), i.clone(), edge_kind::CAUSED_BY))
        .unwrap();
    graph
        .insert_edge(Edge::new(r.clone(), m.clone(), edge_kind::CAUSED_BY))
        .unwrap();
    // A `references` edge that must be filtered out by edge_kinds.
    graph
        .insert_edge(Edge::new(p.clone(), r.clone(), edge_kind::REFERENCES))
        .unwrap();

    let sub = graph
        .traverse(&r, 2, &[edge_kind::CAUSED_BY])
        .unwrap();
    let ids: Vec<&str> = sub.nodes.iter().map(|n| n.id.as_str()).collect();
    assert!(ids.contains(&r.as_str()));
    assert!(ids.contains(&m.as_str()));
    assert!(ids.contains(&i.as_str()));
    // depth 2 from r reaches m (1) and i (2) but NOT p (3)
    assert!(!ids.contains(&p.as_str()));
    // and the `references` edge must not have been followed
    assert!(sub.edges.iter().all(|e| e.kind == edge_kind::CAUSED_BY));
}

#[test]
fn query_by_kind_returns_most_recent_first_within_limit() {
    let graph = Graph::open_in_memory().unwrap();
    for i in 0..5 {
        graph
            .insert_node(Node::new("prompt", json!({ "i": i })))
            .unwrap();
        // ULIDs encode time at ms resolution; sleep to ensure distinct
        // `created_at_ms` values across rows.
        thread::sleep(Duration::from_millis(2));
    }
    let recent = graph.query_by_kind("prompt", 3).unwrap();
    assert_eq!(recent.len(), 3);
    let first = recent[0].body.get("i").and_then(|v| v.as_i64()).unwrap();
    let last = recent[2].body.get("i").and_then(|v| v.as_i64()).unwrap();
    assert!(first > last, "expected DESC order, got {first} > {last}");
}

#[test]
fn query_by_time_is_inclusive() {
    let graph = Graph::open_in_memory().unwrap();
    let a = graph
        .insert_node(Node::new("prompt", json!({ "k": "a" })))
        .unwrap();
    thread::sleep(Duration::from_millis(3));
    let b = graph
        .insert_node(Node::new("prompt", json!({ "k": "b" })))
        .unwrap();
    thread::sleep(Duration::from_millis(3));
    let c = graph
        .insert_node(Node::new("prompt", json!({ "k": "c" })))
        .unwrap();

    let a_node = graph.get_node(&a).unwrap().unwrap();
    let c_node = graph.get_node(&c).unwrap().unwrap();
    let range = graph
        .query_by_time(a_node.created_at_ms, c_node.created_at_ms)
        .unwrap();
    let ids: Vec<&str> = range
        .iter()
        .filter(|n| n.kind == "prompt")
        .map(|n| n.id.as_str())
        .collect();
    assert!(ids.contains(&a.as_str()));
    assert!(ids.contains(&b.as_str()));
    assert!(ids.contains(&c.as_str()));
}

#[test]
fn search_body_matches_substring() {
    let graph = Graph::open_in_memory().unwrap();
    graph
        .insert_node(Node::new("prompt", json!({ "text": "fix the login bug" })))
        .unwrap();
    graph
        .insert_node(Node::new("prompt", json!({ "text": "redesign nav" })))
        .unwrap();
    let hits = graph.search_body("login", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert!(hits[0]
        .body
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap()
        .contains("login"));
}

#[test]
fn current_session_auto_creates_and_reuses_within_window() {
    let graph = Graph::open_in_memory().unwrap();
    let first = graph.current_session().unwrap();
    let second = graph.current_session().unwrap();
    assert_eq!(first, second, "session must be reused within idle window");
    // Inserting a non-session node should not rotate the session either.
    graph
        .insert_node(Node::new("prompt", json!({ "text": "x" })))
        .unwrap();
    let third = graph.current_session().unwrap();
    assert_eq!(first, third);
}

#[test]
fn current_session_rotates_after_idle_window() {
    let graph = Graph::open_in_memory().unwrap();
    let first = graph.current_session().unwrap();
    // Jump 2 hours into the future to bust the 60min idle window.
    let two_hours = 2 * 60 * 60 * 1000;
    let later = first_node_ts(&graph, &first) + two_hours;
    let rotated = graph.__test_current_session_at(later).unwrap();
    assert_ne!(first, rotated, "session should rotate after >60min idle");
}

#[test]
fn traverse_does_not_infinite_loop_on_cycles() {
    let graph = Graph::open_in_memory().unwrap();
    let a = graph
        .insert_node(Node::new("prompt", json!({ "n": "a" })))
        .unwrap();
    let b = graph
        .insert_node(Node::new("prompt", json!({ "n": "b" })))
        .unwrap();
    let c = graph
        .insert_node(Node::new("prompt", json!({ "n": "c" })))
        .unwrap();
    // Build a cycle: a -> b -> c -> a
    graph
        .insert_edge(Edge::new(a.clone(), b.clone(), edge_kind::RELATED_TO))
        .unwrap();
    graph
        .insert_edge(Edge::new(b.clone(), c.clone(), edge_kind::RELATED_TO))
        .unwrap();
    graph
        .insert_edge(Edge::new(c.clone(), a.clone(), edge_kind::RELATED_TO))
        .unwrap();

    let sub = graph
        .traverse(&a, 10, &[edge_kind::RELATED_TO])
        .unwrap();
    // All three nodes visited, no infinite loop, no duplicate ids.
    let mut ids: Vec<&str> = sub.nodes.iter().map(|n| n.id.as_str()).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 3);
}

#[test]
fn stats_counts_are_accurate() {
    let graph = Graph::open_in_memory().unwrap();
    let a = graph
        .insert_node(Node::new("prompt", json!({ "x": 1 })))
        .unwrap();
    let b = graph
        .insert_node(Node::new("intent", json!({ "x": 2 })))
        .unwrap();
    graph
        .insert_edge(Edge::new(a, b, edge_kind::CAUSED_BY))
        .unwrap();

    let stats = graph.stats().unwrap();
    // 2 user nodes + 1 auto-created session.
    assert_eq!(stats.nodes, 3);
    // 1 explicit edge + 2 auto belongs_to_session edges.
    assert_eq!(stats.edges, 3);
    assert_eq!(stats.sessions, 1);
    assert!(stats.last_activity_ms > 0);
}

#[test]
fn auto_helpers_link_prompt_to_intent_to_model_call() {
    let graph = Graph::open_in_memory().unwrap();
    let prompt = auto::record_prompt(&graph, "refactor the auth module").unwrap();
    let intent = auto::record_intent(&graph, &prompt, "refactor").unwrap();
    let call = auto::record_model_call(
        &graph,
        &intent,
        "mercury",
        "mercury-2",
        128,
        256,
        420,
    )
    .unwrap();

    // model_call -> intent (caused_by)
    let call_neighbors = graph
        .neighbors(&call, Some(edge_kind::CAUSED_BY), Direction::Out)
        .unwrap();
    assert!(call_neighbors.iter().any(|(_, n)| n.id == intent));

    // intent -> prompt (caused_by)
    let intent_neighbors = graph
        .neighbors(&intent, Some(edge_kind::CAUSED_BY), Direction::Out)
        .unwrap();
    assert!(intent_neighbors.iter().any(|(_, n)| n.id == prompt));

    // Each non-session node should also have belongs_to_session out-edges.
    for id in [&prompt, &intent, &call] {
        let session_edges = graph
            .neighbors(id, Some(edge_kind::BELONGS_TO_SESSION), Direction::Out)
            .unwrap();
        assert_eq!(session_edges.len(), 1);
        assert_eq!(session_edges[0].1.kind, node_kind::SESSION);
    }
}

#[test]
fn export_jsonl_writes_one_record_per_line() {
    let dir = TempDir::new().unwrap();
    let graph = Graph::open(dir.path()).unwrap();
    let a = graph
        .insert_node(Node::new("prompt", json!({ "text": "hello" })))
        .unwrap();
    let b = graph
        .insert_node(Node::new("intent", json!({ "label": "explain" })))
        .unwrap();
    graph
        .insert_edge(Edge::new(b, a, edge_kind::CAUSED_BY))
        .unwrap();

    let out = dir.path().join("export.jsonl");
    graph.export_jsonl(&out).unwrap();
    let contents = std::fs::read_to_string(&out).unwrap();
    let line_count = contents.lines().count();
    // 2 nodes + 1 session + (2 belongs_to + 1 caused_by) = 3 nodes + 3 edges
    assert_eq!(line_count, 6);
    // Each line parses as JSON.
    for line in contents.lines() {
        let _: serde_json::Value = serde_json::from_str(line).unwrap();
    }
}

fn first_node_ts(graph: &Graph, id: &str) -> u64 {
    graph.get_node(&id.to_string()).unwrap().unwrap().created_at_ms
}
