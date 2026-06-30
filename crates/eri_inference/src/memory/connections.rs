//! The auto-index "dreaming" loop's ingest boundary (ADR-0012, Phase 2 #5).
//!
//! Connection-sourced observations (Gmail / Calendar / … via Composio, fetched
//! server-side and handed to the brain as normalized **metadata + snippets**, never
//! raw bodies) flow into the world model through the SAME proven ingest engine
//! ([`ingest_all`]) — but FIRST through a **refusal-grade Q23 privacy screen** that
//! DROPS anything sensitive **before it is stored**.
//!
//! Data minimization is the spine: a credential / financial / health / intimate
//! snippet never enters the graph at all (not merely un-projected) — nothing stored,
//! nothing to leak. The screen is the ONE canonical [`looks_sensitive`] the recall
//! gate already uses (no copy). Single-principal + idempotent-by-`source_id` are
//! inherited from the user-scoped graph + [`ingest_all`].

use std::io;

use eri_graph::{Graph, GraphError};

use super::Observation;
use super::extraction::{CueExtractor, Extractor, ingest_all};
use super::profile::looks_sensitive;
use super::world_recall::open_world_graph;

/// A normalized observation from a connected account — the PASS-THROUGH shape the
/// website source endpoint returns (metadata + snippet only; raw bodies live
/// nowhere). `source_id` (e.g. `"gmail:<id>"` / `"gcal:<id>"`) is the idempotency +
/// provenance key.
#[derive(Clone, Debug)]
pub struct ConnectionObservation {
    pub source_id: String,
    pub text: String,
    pub kind: String,
    pub ts_ms: u64,
}

/// What a connection ingest did — the [`ingest_all`] counts plus the privacy drop.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct ConnectionIngestReport {
    /// New observation nodes written this run.
    pub ingested: usize,
    /// Already-modelled observations skipped (idempotent by `source_id`).
    pub skipped: usize,
    /// Distinct entities in the world model after the ingest.
    pub entities: usize,
    /// Observations DROPPED by the Q23 screen before storage — the privacy spine.
    pub dropped_sensitive: usize,
}

/// Map a connection observation to the [`ingest_all`] input. The world-graph node
/// carries `source_id` (idempotency + the "where did this come from / forget this"
/// provenance link).
fn to_observation(c: &ConnectionObservation) -> Observation {
    Observation {
        id: c.source_id.clone(),
        kind: c.kind.clone(),
        body: c.text.clone(),
        ts_ms: c.ts_ms,
        ..Default::default()
    }
}

/// Ingest connection observations into one world graph: **Q23-DROP** the sensitive
/// ones BEFORE storage (refusal-grade, fail-closed — the canonical
/// [`looks_sensitive`], no copy), then run the privacy-clean survivors through the
/// proven [`ingest_all`] (entities + relations, idempotent by `source_id`). Pure
/// over the graph — fixture-testable, the seam the privacy leak test exercises.
pub fn ingest_connections_into(
    graph: &Graph,
    extractor: &impl Extractor,
    observations: &[ConnectionObservation],
) -> Result<ConnectionIngestReport, GraphError> {
    let mut kept: Vec<Observation> = Vec::new();
    let mut dropped = 0;
    for o in observations {
        // DROP, not redact: a sensitive observation is removed entirely before it
        // can be stored anywhere in the world model.
        if looks_sensitive(&o.text) {
            dropped += 1;
        } else {
            kept.push(to_observation(o));
        }
    }
    let report = ingest_all(graph, extractor, &kept)?;
    Ok(ConnectionIngestReport {
        ingested: report.ingested,
        skipped: report.skipped,
        entities: report.entities,
        dropped_sensitive: dropped,
    })
}

/// Ingest connection observations into the signed-in user's world model (the
/// user-scoped wrapper: opens `user_id`'s own graph, AAD-isolated). Best-effort IO
/// at the edge; the decision + privacy screen stay in [`ingest_connections_into`].
pub fn ingest_connections(
    user_id: Option<&str>,
    observations: &[ConnectionObservation],
) -> io::Result<ConnectionIngestReport> {
    let graph = open_world_graph(user_id)?;
    ingest_connections_into(&graph, &CueExtractor, observations)
        .map_err(|e| io::Error::other(format!("ingest connections: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use eri_graph::world;

    fn conn(source_id: &str, text: &str) -> ConnectionObservation {
        ConnectionObservation {
            source_id: source_id.into(),
            text: text.into(),
            kind: "email".into(),
            ts_ms: 1,
        }
    }

    fn all_observation_text(g: &Graph) -> String {
        world::recent_observations(g, 10_000)
            .unwrap()
            .iter()
            .map(|o| o.text().to_string())
            .collect::<Vec<_>>()
            .join(" || ")
            .to_lowercase()
    }

    #[test]
    fn a_sensitive_observation_is_dropped_before_it_enters_the_graph() {
        // REFUSAL-GRADE (ADR-0012): Q23-sensitive connection data must NEVER reach
        // the world model — dropped at ingest, provably absent from the graph (same
        // rigor as the recall-gate leak test). One clean obs, four sensitive (one per
        // zone): only the clean one is stored; no sensitive token appears anywhere.
        let g = Graph::open_in_memory().unwrap();
        let obs = [
            conn("gmail:1", "Email from Priya about the atlas project launch"),
            conn("gmail:2", "Your account password is hunter2, reset it here"), // credential
            conn("gmail:3", "Your lab result shows a cholesterol diagnosis"),   // health
            conn(
                "gmail:4",
                "Statement: your bank account balance and routing number",
            ), // financial
            conn("gmail:5", "He admitted to an affair last weekend"),           // intimate
        ];
        let report = ingest_connections_into(&g, &CueExtractor, &obs).unwrap();
        assert_eq!(
            report.dropped_sensitive, 4,
            "all four privacy zones dropped"
        );
        assert_eq!(report.ingested, 1, "only the clean observation is stored");

        let stored = all_observation_text(&g);
        assert!(
            stored.contains("atlas"),
            "the clean observation IS in the graph"
        );
        for forbidden in [
            "password",
            "hunter2",
            "cholesterol",
            "diagnosis",
            "bank account",
            "routing number",
            "affair",
        ] {
            assert!(
                !stored.contains(forbidden),
                "sensitive token {forbidden:?} must never enter the graph"
            );
        }
    }

    #[test]
    fn clean_connection_observations_extract_entities() {
        let g = Graph::open_in_memory().unwrap();
        let report = ingest_connections_into(
            &g,
            &CueExtractor,
            &[conn("gmail:1", "I work with Priya on the atlas project")],
        )
        .unwrap();
        assert_eq!(report.dropped_sensitive, 0);
        assert!(report.entities >= 2, "Priya + atlas, got {report:?}");
    }

    #[test]
    fn connection_ingest_is_idempotent_by_source_id() {
        // Backfill must be resumable: re-ingesting the same source_id stores nothing
        // new (no duplicate nodes).
        let g = Graph::open_in_memory().unwrap();
        let obs = [conn("gmail:1", "lunch with Sam about the harbor app")];
        let first = ingest_connections_into(&g, &CueExtractor, &obs).unwrap();
        assert_eq!((first.ingested, first.skipped), (1, 0));
        let second = ingest_connections_into(&g, &CueExtractor, &obs).unwrap();
        assert_eq!((second.ingested, second.skipped), (0, 1));
    }
}
