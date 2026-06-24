//! Cold-path reflection (ADR-0007 §3): the base engine reads a BATCH of
//! observations and returns the entities + relations it infers.
//!
//! Distinct from ingest. Ingest stays zero-token deterministic
//! ([`CueExtractor`](super::extraction::CueExtractor)) on the hot path;
//! reflection is the batched, model-driven upgrade on the **cold** path and
//! never sits on ingest (a cloud call per write would be the wrong shape, wrong
//! path, and a token disaster). Its output is **untrusted model text crossing a
//! system boundary**, so [`parse_reflection`] is defensive: malformed input
//! yields nothing (never panics), unknown kinds/relations and dangling edges are
//! dropped, and the count is capped so a runaway reply can't flood the graph.
//!
//! Reflection-derived facts are MODEL-INFERRED — lower confidence than direct
//! observations — so the write step (cold-path wiring, below) tags their
//! provenance and attaches evidence back to the source observations, keeping the
//! bi-temporal/provenance contract intact.

use std::collections::HashMap;
use std::io;

use serde_json::Value;

use eri_graph::{Graph, GraphError, NodeId, world};

use super::extraction::{EntityMention, Extraction, RelationMention};

/// Provenance tag for facts derived by the base-engine reflection pass — distinct
/// from a direct observation: model-inferred, lower-confidence, supersedable. Read
/// it from an evidence/relation edge's `metadata.source`.
pub const REFLECTION_SOURCE: &str = "reflection";

/// Max entities accepted from one reflection response — a runaway or adversarial
/// reply can't flood the graph.
const MAX_ENTITIES: usize = 64;
/// Max relations accepted from one reflection response.
const MAX_RELATIONS: usize = 128;

/// Parse a base-engine reflection response into an [`Extraction`]. **Defensive** —
/// the response is untrusted model output, treated like any external input:
///
/// - malformed / partial JSON → empty (never panics);
/// - unknown entity kinds / relation kinds → dropped;
/// - relations whose endpoints aren't among the parsed entities → dropped (no
///   edges to fabricated nodes);
/// - entity / relation counts capped at [`MAX_ENTITIES`] / [`MAX_RELATIONS`].
pub fn parse_reflection(response: &str) -> Extraction {
    let Some(value) = parse_json_object(response) else {
        return Extraction::default();
    };
    let entities = parse_entities(&value);
    let relations = parse_relations(&value, &entities);
    Extraction {
        entities,
        relations,
    }
}

/// Find and parse the first balanced JSON object in `response`, tolerating
/// markdown fences / preamble a model may wrap around it. `None` when there is no
/// parseable object — the caller maps that to an empty [`Extraction`].
fn parse_json_object(response: &str) -> Option<Value> {
    let start = response.find('{')?;
    let end = response.rfind('}')?;
    if end < start {
        return None;
    }
    serde_json::from_str(&response[start..=end]).ok()
}

/// The entity mentions in the response, kinds mapped to known
/// [`world::entity_kind`] constants (unknown dropped), de-duplicated, capped.
fn parse_entities(value: &Value) -> Vec<EntityMention> {
    let Some(arr) = value.get("entities").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut out: Vec<EntityMention> = Vec::new();
    for item in arr {
        if out.len() >= MAX_ENTITIES {
            break;
        }
        let Some(kind) = item
            .get("kind")
            .and_then(Value::as_str)
            .and_then(map_entity_kind)
        else {
            continue;
        };
        let Some(name) = clean_name(item.get("name")) else {
            continue;
        };
        let mention = EntityMention { kind, name };
        if !out.contains(&mention) {
            out.push(mention);
        }
    }
    out
}

/// The relation mentions in the response, relation kinds mapped to known
/// [`world::relation`] constants (unknown dropped), endpoints required to be
/// among `entities` (dangling dropped — no edge to a fabricated node), capped.
fn parse_relations(value: &Value, entities: &[EntityMention]) -> Vec<RelationMention> {
    let Some(arr) = value.get("relations").and_then(Value::as_array) else {
        return Vec::new();
    };
    let surfaced = |name: &str| entities.iter().any(|e| e.name == name);
    let mut out: Vec<RelationMention> = Vec::new();
    for item in arr {
        if out.len() >= MAX_RELATIONS {
            break;
        }
        let Some(relation) = item
            .get("relation")
            .and_then(Value::as_str)
            .and_then(map_relation)
        else {
            continue;
        };
        let (Some(src), Some(dst)) = (clean_name(item.get("src")), clean_name(item.get("dst")))
        else {
            continue;
        };
        // Drop dangling edges: an endpoint not surfaced as an entity this batch
        // would point at a node we never resolved.
        if !surfaced(&src) || !surfaced(&dst) {
            continue;
        }
        out.push(RelationMention { src, dst, relation });
    }
    out
}

/// A trimmed, non-blank name from a JSON string field, or `None`.
fn clean_name(field: Option<&Value>) -> Option<String> {
    field
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Map a model-emitted entity-kind name to a known [`world::entity_kind`]
/// constant, or `None` (dropped). Accepts the bare names the reflection prompt
/// asks for.
fn map_entity_kind(kind: &str) -> Option<&'static str> {
    match kind.trim().to_lowercase().as_str() {
        "person" => Some(world::entity_kind::PERSON),
        "project" => Some(world::entity_kind::PROJECT),
        "app" => Some(world::entity_kind::APP),
        "topic" => Some(world::entity_kind::TOPIC),
        "place" => Some(world::entity_kind::PLACE),
        "life_event" | "life event" => Some(world::entity_kind::LIFE_EVENT),
        _ => None,
    }
}

/// Map a model-emitted relation name to a known [`world::relation`] constant, or
/// `None` (dropped).
fn map_relation(relation: &str) -> Option<&'static str> {
    match relation.trim().to_lowercase().as_str() {
        "works_with" | "works with" => Some(world::relation::WORKS_WITH),
        "collaborates_on" | "collaborates on" => Some(world::relation::COLLABORATES_ON),
        "owns" => Some(world::relation::OWNS),
        "uses" => Some(world::relation::USES),
        "part_of" | "part of" => Some(world::relation::PART_OF),
        _ => None,
    }
}

/// Apply a base-engine reflection `response` over a batch of `sources`
/// (each an observation node + its text) to the user's world graph.
///
/// Parses defensively ([`parse_reflection`]), then writes each entity **grounded
/// in observed text** — an entity named in no source text is dropped (no
/// fabrication) — with **reflection provenance** and evidence back to the
/// observation(s) that mention it, then relates co-mentions (also reflection
/// provenance). Reuses the idempotent ingest resolution
/// ([`world::upsert_entity`]), so a reflection-confirmed entity merges onto the
/// one already in the graph. Returns the number of distinct entities written.
///
/// **User-scoped by construction**: the caller opens the signed-in user's graph
/// and passes it here; reflection never writes across users.
pub fn apply_reflection(
    graph: &Graph,
    sources: &[(NodeId, &str)],
    response: &str,
) -> Result<usize, GraphError> {
    let extraction = parse_reflection(response);
    let mut ids: HashMap<String, NodeId> = HashMap::new();

    for m in &extraction.entities {
        // Ground the inferred entity in observed text: only write it for the
        // source observation(s) that actually mention it. An entity the model
        // returned but no source names is fabricated — drop it.
        let mut entity_id = None;
        for (obs, _) in sources.iter().filter(|(_, text)| mentions(text, &m.name)) {
            entity_id = Some(world::link_evidence_with_source(
                graph,
                obs,
                m.kind,
                &m.name,
                REFLECTION_SOURCE,
            )?);
        }
        if let Some(id) = entity_id {
            ids.insert(m.name.clone(), id);
        }
    }

    for r in &extraction.relations {
        // Both endpoints must be entities we actually wrote (grounded) — no edge
        // to a fabricated node.
        if let (Some(src), Some(dst)) = (ids.get(&r.src), ids.get(&r.dst)) {
            world::relate_with_source(graph, src, dst, r.relation, REFLECTION_SOURCE)?;
        }
    }
    Ok(ids.len())
}

/// Whole-word, case-insensitive: does `text` mention `name`? Grounds an inferred
/// entity in observed text. (The graph-wide "does this text mention any KNOWN
/// entity" scan is [`world::mentions_known_entity`]; this is the narrow
/// does-THIS-text-mention-THIS-name check the reflection write needs.)
fn mentions(text: &str, name: &str) -> bool {
    let hay = tokenize(text);
    let needle = tokenize(name);
    if needle.is_empty() {
        return false;
    }
    hay.windows(needle.len()).any(|w| w == needle.as_slice())
}

/// Lowercase alphanumeric word tokens of `s`.
fn tokenize(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_lowercase())
        .collect()
}

// --- cold-path batch flush (user-scoped facade) -------------------------------

/// The reflection prompt over a batch of observation texts. Instructs the base
/// engine to return ONLY the JSON shape [`parse_reflection`] expects and to
/// invent nothing not in the text — the defensive parser is the backstop, not the
/// first line of defense.
pub fn reflection_prompt(observations: &[&str]) -> String {
    let mut s = String::from(
        "You are eri's reflection pass. Read these observations about one person and extract the \
         entities and the relations between them that the text evidences.\n\
         Respond with ONLY a JSON object of EXACTLY this shape (no prose, no markdown fences):\n\
         {\"entities\":[{\"kind\":\"person|project|app|topic|place|life_event\",\"name\":\"name as written\"}],\
         \"relations\":[{\"src\":\"entity name\",\"dst\":\"entity name\",\"relation\":\"works_with|collaborates_on|owns|uses|part_of\"}]}\n\
         Rules: use ONLY names that literally appear in the observations; invent nothing; relate \
         only entities you listed; if nothing is evidenced, return empty arrays.\n\n\
         Observations:\n",
    );
    for (i, obs) in observations.iter().enumerate() {
        s.push_str(&format!("{}. {}\n", i + 1, obs.trim()));
    }
    s
}

/// A batch of the user's recent observations to reflect over — **opaque**: the
/// observation node ids stay inside `eri_inference`, so the async orchestration
/// in `eri_cli` never names `eri_graph` (ADR-0007 seam). Build with
/// [`reflection_batch`], read [`texts`](Self::texts) for the prompt, apply a
/// response with [`apply_batch`].
pub struct ReflectionBatch {
    items: Vec<(NodeId, String)>,
}

impl ReflectionBatch {
    /// The observation texts, in batch order — the input to [`reflection_prompt`].
    pub fn texts(&self) -> Vec<&str> {
        self.items.iter().map(|(_, t)| t.as_str()).collect()
    }

    /// Whether there is nothing to reflect over.
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// How many observations are in the batch.
    pub fn len(&self) -> usize {
        self.items.len()
    }
}

/// Collect the user's most recent observations (up to `limit`) into a batch.
/// User-scoped (opens the signed-in user's world graph). Best-effort.
pub fn reflection_batch(user_id: Option<&str>, limit: usize) -> io::Result<ReflectionBatch> {
    let graph = super::world_recall::open_world_graph(user_id)?;
    let items = world::recent_observations(&graph, limit)
        .map_err(|e| io::Error::other(format!("recent_observations: {e}")))?
        .into_iter()
        .map(|o| (o.id().clone(), o.text().to_string()))
        .collect();
    Ok(ReflectionBatch { items })
}

/// Apply a base-engine reflection `response` for `batch` to the user's world
/// graph (re-opens it user-scoped — node ids are stable across opens). Returns
/// the number of entities written.
pub fn apply_batch(
    user_id: Option<&str>,
    batch: &ReflectionBatch,
    response: &str,
) -> io::Result<usize> {
    let graph = super::world_recall::open_world_graph(user_id)?;
    let sources: Vec<(NodeId, &str)> = batch
        .items
        .iter()
        .map(|(id, t)| (id.clone(), t.as_str()))
        .collect();
    apply_reflection(&graph, &sources, response)
        .map_err(|e| io::Error::other(format!("apply_reflection: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_well_formed_reflection() {
        let r = parse_reflection(
            r#"{
                "entities": [
                    {"kind": "person", "name": "Priya"},
                    {"kind": "project", "name": "atlas"}
                ],
                "relations": [
                    {"src": "Priya", "dst": "atlas", "relation": "collaborates_on"}
                ]
            }"#,
        );
        assert_eq!(
            r.entities,
            vec![
                EntityMention {
                    kind: world::entity_kind::PERSON,
                    name: "Priya".into()
                },
                EntityMention {
                    kind: world::entity_kind::PROJECT,
                    name: "atlas".into()
                },
            ]
        );
        assert_eq!(
            r.relations,
            vec![RelationMention {
                src: "Priya".into(),
                dst: "atlas".into(),
                relation: world::relation::COLLABORATES_ON,
            }]
        );
    }

    #[test]
    fn malformed_or_truncated_json_yields_nothing_never_panics() {
        assert_eq!(parse_reflection("not json at all"), Extraction::default());
        assert_eq!(parse_reflection(""), Extraction::default());
        assert_eq!(parse_reflection("{}"), Extraction::default());
        // Truncated mid-object — serde rejects it, we return empty, no panic.
        assert_eq!(
            parse_reflection(r#"{"entities": [{"kind": "per"#),
            Extraction::default()
        );
    }

    #[test]
    fn tolerates_markdown_fences_and_preamble() {
        let r = parse_reflection(
            "Here's what I inferred:\n```json\n{\"entities\":[{\"kind\":\"person\",\"name\":\"Sam\"}],\"relations\":[]}\n```",
        );
        assert_eq!(
            r.entities,
            vec![EntityMention {
                kind: world::entity_kind::PERSON,
                name: "Sam".into()
            }]
        );
    }

    #[test]
    fn drops_unknown_kinds_and_relations() {
        let r = parse_reflection(
            r#"{
                "entities": [
                    {"kind": "alien", "name": "Zorp"},
                    {"kind": "person", "name": "Priya"}
                ],
                "relations": [
                    {"src": "Priya", "dst": "Priya", "relation": "hates"}
                ]
            }"#,
        );
        assert_eq!(
            r.entities,
            vec![EntityMention {
                kind: world::entity_kind::PERSON,
                name: "Priya".into()
            }],
            "an unknown entity kind is dropped"
        );
        assert!(
            r.relations.is_empty(),
            "an unknown relation kind is dropped"
        );
    }

    #[test]
    fn drops_dangling_relations_to_unsurfaced_endpoints() {
        // "Bob" was never surfaced as an entity → no edge to a fabricated node.
        let r = parse_reflection(
            r#"{
                "entities": [{"kind": "project", "name": "atlas"}],
                "relations": [{"src": "Bob", "dst": "atlas", "relation": "collaborates_on"}]
            }"#,
        );
        assert!(
            r.relations.is_empty(),
            "a relation to an unsurfaced entity is dropped"
        );
    }

    #[test]
    fn caps_a_runaway_response() {
        let entities: String = (0..1000)
            .map(|i| format!(r#"{{"kind":"person","name":"P{i}"}}"#))
            .collect::<Vec<_>>()
            .join(",");
        let r = parse_reflection(&format!(r#"{{"entities":[{entities}],"relations":[]}}"#));
        assert_eq!(
            r.entities.len(),
            MAX_ENTITIES,
            "a flood of entities is capped"
        );
    }

    #[test]
    fn blank_names_and_missing_fields_are_dropped_not_crashed() {
        let r = parse_reflection(
            r#"{"entities":[{"kind":"person","name":"   "},{"kind":"person"}],"relations":[]}"#,
        );
        assert!(
            r.entities.is_empty(),
            "a blank or missing name yields no entity"
        );
    }

    // --- apply_reflection: the grounded, provenance-tagged write ---------------

    use eri_graph::{Direction, Graph};

    const T1: &str = "Spent the afternoon with Priya on the atlas project";
    const T2: &str = "atlas needs a design review";

    #[test]
    fn apply_reflection_writes_grounded_entities_and_relations() {
        let g = Graph::open_in_memory().unwrap();
        let o1 = world::record_observation(&g, T1).unwrap();
        let o2 = world::record_observation(&g, T2).unwrap();
        let sources = vec![(o1, T1), (o2, T2)];

        // The base engine's (fixture) reading: Priya + atlas + their collaboration,
        // PLUS a fabricated "Zorp" that appears in no source text.
        let response = r#"{
            "entities": [
                {"kind":"person","name":"Priya"},
                {"kind":"project","name":"atlas"},
                {"kind":"person","name":"Zorp"}
            ],
            "relations": [{"src":"Priya","dst":"atlas","relation":"collaborates_on"}]
        }"#;

        let written = apply_reflection(&g, &sources, response).unwrap();
        assert_eq!(written, 2, "Priya + atlas written; ungrounded Zorp dropped");

        let people = world::entities_of_kind(&g, world::entity_kind::PERSON).unwrap();
        assert!(people.iter().any(|e| e.canonical_name() == "Priya"));
        assert!(
            !people.iter().any(|e| e.canonical_name() == "Zorp"),
            "an entity named in no source text is not fabricated"
        );

        let priya = people
            .into_iter()
            .find(|e| e.canonical_name() == "Priya")
            .unwrap();
        let atlas = world::entities_of_kind(&g, world::entity_kind::PROJECT)
            .unwrap()
            .into_iter()
            .find(|e| e.canonical_name() == "atlas")
            .unwrap();
        let collab = world::related(&g, priya.id(), world::relation::COLLABORATES_ON).unwrap();
        assert!(
            collab.iter().any(|e| e.id() == atlas.id()),
            "the inferred collaboration relation holds"
        );

        // atlas is mentioned in BOTH observations → evidenced by both.
        assert_eq!(
            world::evidence_for(&g, atlas.id()).unwrap().len(),
            2,
            "evidence attaches to every source observation that mentions the entity"
        );
    }

    #[test]
    fn reflection_writes_carry_inferred_provenance_not_observed() {
        let g = Graph::open_in_memory().unwrap();
        let o1 = world::record_observation(&g, T1).unwrap();
        let sources = vec![(o1, T1)];
        let response = r#"{"entities":[{"kind":"person","name":"Priya"}],"relations":[]}"#;
        apply_reflection(&g, &sources, response).unwrap();

        let priya = world::entities_of_kind(&g, world::entity_kind::PERSON)
            .unwrap()
            .into_iter()
            .find(|e| e.canonical_name() == "Priya")
            .unwrap();
        // The evidence edge is tagged source="reflection" — model-inferred, kept
        // distinct from a direct observation so the predict step can weight it.
        let evidence_edges = g
            .neighbors(priya.id(), Some(world::relation::EVIDENCES), Direction::In)
            .unwrap();
        assert!(
            evidence_edges
                .iter()
                .all(|(e, _)| e.metadata.get("source").and_then(|v| v.as_str())
                    == Some(REFLECTION_SOURCE)),
            "reflection-derived evidence is tagged as inferred"
        );
    }

    #[test]
    fn the_prompt_carries_the_observations_and_the_output_contract() {
        let p = reflection_prompt(&["Met Priya about atlas", "atlas ships Friday"]);
        assert!(p.contains("Met Priya about atlas") && p.contains("atlas ships Friday"));
        // The output contract the defensive parser expects.
        assert!(p.contains("\"entities\"") && p.contains("\"relations\""));
        assert!(p.contains("collaborates_on"), "lists the allowed relations");
        assert!(
            p.to_lowercase().contains("invent nothing"),
            "tells the model not to fabricate"
        );
    }

    #[test]
    fn a_garbage_reflection_response_writes_nothing() {
        let g = Graph::open_in_memory().unwrap();
        let o1 = world::record_observation(&g, T1).unwrap();
        let sources = vec![(o1, T1)];
        assert_eq!(
            apply_reflection(&g, &sources, "the model errored").unwrap(),
            0
        );
        assert!(
            world::entities_of_kind(&g, world::entity_kind::PERSON)
                .unwrap()
                .is_empty()
        );
    }
}
