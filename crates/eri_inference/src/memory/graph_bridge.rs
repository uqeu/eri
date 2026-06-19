//! Bridge from the episodic memory store into the world-model graph (ADR-0007).
//!
//! Step toward unifying memory into `eri_graph`: an [`Observation`] is written
//! as a `world::node_kind::OBSERVATION` node that carries its full lifecycle —
//! transaction-time (`learned_at`), event-time (`valid_from`), `visibility`,
//! `importance`, and reinforcement counters — so nothing is lost when memory
//! lives in the graph. Additive for now (the JSON store is untouched); the full
//! backend cutover builds on this mapping.

use eri_graph::{Graph, GraphError, Node, NodeId, world};
use serde_json::{Value, json};

use super::{Observation, Visibility};

/// Map an observation's lifecycle to a `(state, valid_to)` pair for the body.
fn visibility_fields(visibility: &Visibility) -> (&'static str, Option<u64>) {
    match visibility {
        Visibility::Active => ("active", None),
        Visibility::Superseded { valid_to } => ("superseded", *valid_to),
        Visibility::Consolidated => ("consolidated", None),
    }
}

/// The graph node body for an observation — every lifecycle field preserved.
pub fn observation_body(obs: &Observation) -> Value {
    let (visibility, valid_to) = visibility_fields(&obs.visibility);
    json!({
        "text": obs.body,
        "source_id": obs.id,
        "obs_kind": obs.kind,
        "workspace_hash": obs.workspace_hash,
        "learned_at": obs.ts_ms,
        "valid_from": obs.valid_from(),
        "valid_to": valid_to,
        "visibility": visibility,
        "importance": obs.importance,
        "recall_count": obs.recall_count,
        "last_recalled_ms": obs.last_recalled_ms,
    })
}

/// Write an observation into the graph as an observation node, returning its
/// graph node id.
pub fn write_observation(graph: &Graph, obs: &Observation) -> Result<NodeId, GraphError> {
    graph.insert_node(Node::new(
        world::node_kind::OBSERVATION,
        observation_body(obs),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_observation_becomes_a_graph_node_preserving_its_lifecycle_fields() {
        let g = Graph::open_in_memory().unwrap();
        let obs = Observation {
            id: "obs-1".into(),
            ts_ms: 500,
            kind: "fact".into(),
            workspace_hash: "ws".into(),
            body: "Sam loves Rintaro".into(),
            valid_from: Some(300),
            importance: 0.8,
            recall_count: 2,
            ..Default::default()
        };

        let node_id = write_observation(&g, &obs).unwrap();
        let node = g.get_node(&node_id).unwrap().unwrap();

        assert_eq!(node.kind, world::node_kind::OBSERVATION);
        assert_eq!(node.body.get("text").unwrap(), "Sam loves Rintaro");
        assert_eq!(node.body.get("source_id").unwrap(), "obs-1");
        assert_eq!(node.body.get("learned_at").unwrap(), 500);
        // event-time start is preserved distinct from transaction time
        assert_eq!(node.body.get("valid_from").unwrap(), 300);
        assert_eq!(node.body.get("visibility").unwrap(), "active");
        let importance = node.body.get("importance").unwrap().as_f64().unwrap();
        assert!((importance - 0.8).abs() < 1e-6, "importance preserved");
        assert_eq!(node.body.get("recall_count").unwrap(), 2);
    }

    #[test]
    fn a_superseded_observation_carries_its_valid_to() {
        let g = Graph::open_in_memory().unwrap();
        let obs = Observation {
            body: "old fact".into(),
            visibility: Visibility::Superseded {
                valid_to: Some(900),
            },
            ..Default::default()
        };

        let node = g
            .get_node(&write_observation(&g, &obs).unwrap())
            .unwrap()
            .unwrap();

        assert_eq!(node.body.get("visibility").unwrap(), "superseded");
        assert_eq!(node.body.get("valid_to").unwrap(), 900);
    }
}
