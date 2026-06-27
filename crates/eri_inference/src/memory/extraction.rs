//! Reflection-pass extraction (ADR-0007 §3, two-pass world model).
//!
//! The *additive* world-model layer: the episodic [`MemoryStore`](super::MemoryStore)
//! (JSON) is left untouched; on insert the caller *also* runs
//! [`ingest_observation`] so the same fact becomes queryable as
//! people/projects/relations in `eri_graph`. Ingest stays on the cheap local
//! tier (zero cloud tokens) — a [`CueExtractor`] does conservative cue-based
//! tagging — while a base-engine [`Extractor`] is the pluggable upgrade for hard
//! disambiguation (mocked in tests). The base engine never sits on this hot path.

use std::collections::{HashMap, HashSet};

use eri_graph::{Graph, GraphError, NodeId, world};
use serde_json::Value;

use super::Observation;
use super::graph_bridge;

/// A mention of an entity found in an observation's text. `kind` is one of
/// [`world::entity_kind`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntityMention {
    pub kind: &'static str,
    pub name: String,
}

/// A relation between two named entities found in the text. `relation` is one of
/// [`world::relation`]; `src`/`dst` name entities the same [`Extraction`] also
/// surfaced (ingest only relates endpoints it has resolved).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelationMention {
    pub src: String,
    pub dst: String,
    pub relation: &'static str,
}

/// The reflection pass's reading of one observation: the entities it mentions and
/// the relations between them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Extraction {
    pub entities: Vec<EntityMention>,
    pub relations: Vec<RelationMention>,
}

/// Pluggable reflection-pass extractor (ADR-0007 §3). [`CueExtractor`] is the
/// zero-token cold-start default; a base-engine extractor is the upgrade.
pub trait Extractor {
    fn extract(&self, text: &str) -> Extraction;
}

/// Cue-based, zero-token, deterministic extractor — the cold-start default that
/// runs on the ingest hot path. Conservative on purpose (a missed entity costs
/// less than a wrong merge): the base-engine extractor is the confirmer for hard
/// cases.
pub struct CueExtractor;

/// Words that, when they immediately precede a Proper Noun, signal that noun is a
/// person eri interacts with ("met **Priya**", "told **Sam**").
const PERSON_CUES: &[&str] = &[
    "with", "met", "told", "saw", "emailed", "called", "texted", "pinged", "asked", "from", "to",
];

/// Nouns that, when they immediately follow a name, mark that name as a project
/// ("the **eri** project", "the **checkout** app").
const PROJECT_NOUNS: &[&str] = &["project", "app", "repo", "codebase", "startup"];

/// Articles/possessives that are never an entity name on their own.
const NAME_STOPWORDS: &[&str] = &[
    "the", "a", "an", "my", "our", "this", "that", "your", "their", "his", "her", "its",
];

/// Verbs signalling the user collaborates on something — when present alongside a
/// person and a project, eri records the person as a collaborator on the project.
const COLLAB_CUES: &[&str] = &[
    "work",
    "working",
    "works",
    "worked",
    "collaborate",
    "collaborating",
    "build",
    "building",
    "built",
    "ship",
    "shipping",
    "pair",
    "pairing",
];

impl Extractor for CueExtractor {
    fn extract(&self, text: &str) -> Extraction {
        let words: Vec<&str> = text.split_whitespace().collect();
        let mut entities: Vec<EntityMention> = Vec::new();

        for i in 1..words.len() {
            // person cue: a Proper Noun right after an interaction verb/preposition.
            let prev = normalize_cue(words[i - 1]);
            if PERSON_CUES.contains(&prev.as_str())
                && let Some(name) = proper_noun(words[i])
            {
                push_unique(
                    &mut entities,
                    EntityMention {
                        kind: world::entity_kind::PERSON,
                        name,
                    },
                );
            }
            // project cue: the name right before a project noun ("eri project").
            if PROJECT_NOUNS.contains(&normalize_cue(words[i]).as_str())
                && let Some(name) = entity_name(words[i - 1])
            {
                push_unique(
                    &mut entities,
                    EntityMention {
                        kind: world::entity_kind::PROJECT,
                        name,
                    },
                );
            }
        }

        let relations = collaboration_relations(&words, &entities);
        Extraction {
            entities,
            relations,
        }
    }
}

/// When a collaboration verb is present, record each extracted person as a
/// collaborator on each extracted project (person `--collaborates_on--> project`).
/// Conservative co-mention heuristic; the base-engine extractor disambiguates
/// multi-entity sentences later.
fn collaboration_relations(words: &[&str], entities: &[EntityMention]) -> Vec<RelationMention> {
    let has_cue = words
        .iter()
        .any(|w| COLLAB_CUES.contains(&normalize_cue(w).as_str()));
    if !has_cue {
        return Vec::new();
    }
    let people = entities
        .iter()
        .filter(|e| e.kind == world::entity_kind::PERSON);
    let projects: Vec<&EntityMention> = entities
        .iter()
        .filter(|e| e.kind == world::entity_kind::PROJECT)
        .collect();
    let mut relations = Vec::new();
    for person in people {
        for project in &projects {
            relations.push(RelationMention {
                src: person.name.clone(),
                dst: project.name.clone(),
                relation: world::relation::COLLABORATES_ON,
            });
        }
    }
    relations
}

/// Lowercased, punctuation-stripped form of a cue word for matching.
fn normalize_cue(word: &str) -> String {
    word.trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase()
}

/// A cleaned Proper Noun (leading-uppercase, alphabetic, ≥2 chars) or `None`.
/// Strips surrounding punctuation so "Alice," resolves to "Alice".
fn proper_noun(word: &str) -> Option<String> {
    let cleaned: String = word
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_string();
    let mut chars = cleaned.chars();
    let first = chars.next()?;
    if first.is_uppercase() && cleaned.chars().all(|c| c.is_alphabetic()) && cleaned.len() >= 2 {
        Some(cleaned)
    } else {
        None
    }
}

/// A cleaned entity name (punctuation-stripped, ≥2 chars, not an article/
/// possessive). Unlike [`proper_noun`] this allows lowercase, so project names
/// like "eri" qualify.
fn entity_name(word: &str) -> Option<String> {
    let cleaned: String = word
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_string();
    if cleaned.len() < 2 || NAME_STOPWORDS.contains(&cleaned.to_lowercase().as_str()) {
        return None;
    }
    Some(cleaned)
}

/// Append `m` only if no mention with the same (kind, name) is already present.
fn push_unique(entities: &mut Vec<EntityMention>, m: EntityMention) {
    if !entities.contains(&m) {
        entities.push(m);
    }
}

/// Reflection pass over one observation: write it as a graph node (preserving its
/// lifecycle via [`graph_bridge`]), resolve + link every extracted entity as
/// evidence, then relate co-mentioned entities. Returns the observation node id.
///
/// Additive — never touches the JSON [`MemoryStore`](super::MemoryStore). Entity
/// resolution is idempotent (see [`world::upsert_entity`]), so re-seeing a person
/// accumulates evidence on the one entity instead of forking a new one.
pub fn ingest_observation(
    graph: &Graph,
    extractor: &impl Extractor,
    obs: &Observation,
) -> Result<NodeId, GraphError> {
    let obs_node = graph_bridge::write_observation(graph, obs)?;
    let extraction = extractor.extract(&obs.body);

    let mut ids: HashMap<&str, NodeId> = HashMap::new();
    for m in &extraction.entities {
        let entity = world::link_evidence(graph, &obs_node, m.kind, &m.name)?;
        ids.insert(m.name.as_str(), entity);
    }
    for r in &extraction.relations {
        if let (Some(src), Some(dst)) = (ids.get(r.src.as_str()), ids.get(r.dst.as_str())) {
            world::relate(graph, src, dst, r.relation)?;
        }
    }
    Ok(obs_node)
}

/// What a bulk [`ingest_all`] did — for the CLI summary + tests.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct IngestReport {
    /// New observation nodes written this run.
    pub ingested: usize,
    /// Observations already in the graph (matched by `source_id`) — skipped, so a
    /// re-run never duplicates.
    pub skipped: usize,
    /// Distinct entities in the world model after the ingest.
    pub entities: usize,
}

/// The most observation nodes one ingest scans for the already-ingested set.
/// Generous for a per-person model; swap for an index if it ever bottlenecks.
const INGEST_SCAN_LIMIT: usize = 100_000;

/// Bulk-ingest `observations` into the world model via [`ingest_observation`],
/// extracting entities/relations with `extractor`. **Idempotent** — an observation
/// whose `source_id` is already a node is skipped, so re-running never duplicates —
/// and **additive**: the JSON [`MemoryStore`](super::MemoryStore) is never touched,
/// and every entity keeps an `EVIDENCES` link back to its source observation node
/// (which carries `source_id`), the provenance an editable "where did this come from
/// / forget this" memory UI reads. Best-effort per item is the caller's choice; here
/// a single failure aborts the batch (a graph error is not per-observation).
pub fn ingest_all(
    graph: &Graph,
    extractor: &impl Extractor,
    observations: &[Observation],
) -> Result<IngestReport, GraphError> {
    let already = ingested_source_ids(graph)?;
    let mut report = IngestReport::default();
    for obs in observations {
        if already.contains(obs.id.as_str()) {
            report.skipped += 1;
            continue;
        }
        ingest_observation(graph, extractor, obs)?;
        report.ingested += 1;
    }
    report.entities = entity_count(graph)?;
    Ok(report)
}

/// The `source_id`s of observation nodes already in the graph — the idempotency key
/// so a re-ingest skips what's already modelled.
fn ingested_source_ids(graph: &Graph) -> Result<HashSet<String>, GraphError> {
    let mut ids = HashSet::new();
    for node in graph.query_by_kind(world::node_kind::OBSERVATION, INGEST_SCAN_LIMIT)? {
        if let Some(sid) = node.body.get("source_id").and_then(Value::as_str) {
            ids.insert(sid.to_string());
        }
    }
    Ok(ids)
}

/// Total entities across every kind — the ingest report's headline number.
fn entity_count(graph: &Graph) -> Result<usize, GraphError> {
    let mut n = 0;
    for kind in world::ENTITY_KINDS {
        n += world::entities_of_kind(graph, kind)?.len();
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fact(body: &str) -> Observation {
        Observation {
            kind: "fact".into(),
            body: body.into(),
            ..Default::default()
        }
    }

    fn fact_id(id: &str, body: &str) -> Observation {
        Observation {
            id: id.into(),
            kind: "fact".into(),
            body: body.into(),
            ..Default::default()
        }
    }

    #[test]
    fn ingest_all_extracts_entities_across_a_batch() {
        let g = Graph::open_in_memory().unwrap();
        let report = ingest_all(
            &g,
            &CueExtractor,
            &[
                fact_id("o1", "I work with Alice on the eri project"),
                fact_id("o2", "deploys on vercel"),
            ],
        )
        .unwrap();
        assert_eq!(report.ingested, 2);
        assert_eq!(report.skipped, 0);
        assert!(report.entities >= 2, "Alice + eri at least, got {report:?}");
    }

    #[test]
    fn ingest_all_is_idempotent_by_source_id() {
        let g = Graph::open_in_memory().unwrap();
        let obs = [
            fact_id("o1", "I work with Alice on the eri project"),
            fact_id("o2", "deploys on vercel"),
        ];
        let first = ingest_all(&g, &CueExtractor, &obs).unwrap();
        assert_eq!((first.ingested, first.skipped), (2, 0));

        // Re-running ingests nothing new — every observation's source_id is already
        // a node, so it's skipped, and the entity count is unchanged.
        let second = ingest_all(&g, &CueExtractor, &obs).unwrap();
        assert_eq!((second.ingested, second.skipped), (0, 2));
        assert_eq!(
            second.entities, first.entities,
            "no new entities on a re-run"
        );
    }

    #[test]
    fn an_ingested_entity_traces_back_to_its_source_observation() {
        // The provenance the editable "where did this come from / forget this" memory
        // UI depends on: an entity's evidence carries the source memory-store id.
        let g = Graph::open_in_memory().unwrap();
        ingest_all(
            &g,
            &CueExtractor,
            &[fact_id("obs-42", "I work with Alice on the eri project")],
        )
        .unwrap();

        let alice = world::find_entity(&g, world::entity_kind::PERSON, "Alice")
            .unwrap()
            .expect("Alice is an entity");
        let evidence = world::evidence_for(&g, alice.id()).unwrap();
        assert!(
            evidence.iter().any(|o| o.source_id() == Some("obs-42")),
            "Alice's evidence must point back to source observation obs-42"
        );
    }

    #[test]
    fn ingesting_a_collaboration_records_the_person_as_an_entity() {
        let g = Graph::open_in_memory().unwrap();
        ingest_observation(
            &g,
            &CueExtractor,
            &fact("I work with Alice on the eri project"),
        )
        .unwrap();

        let people = world::entities_of_kind(&g, world::entity_kind::PERSON).unwrap();
        assert!(
            people.iter().any(|e| e.canonical_name() == "Alice"),
            "Alice should be a person entity, got: {:?}",
            people
                .iter()
                .map(|e| e.canonical_name().to_string())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn ingesting_a_collaboration_records_the_project_as_an_entity() {
        let g = Graph::open_in_memory().unwrap();
        ingest_observation(
            &g,
            &CueExtractor,
            &fact("I work with Alice on the eri project"),
        )
        .unwrap();

        let projects = world::entities_of_kind(&g, world::entity_kind::PROJECT).unwrap();
        assert!(
            projects.iter().any(|e| e.canonical_name() == "eri"),
            "eri should be a project entity, got: {:?}",
            projects
                .iter()
                .map(|e| e.canonical_name().to_string())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn a_collaboration_relates_the_person_to_the_project() {
        let g = Graph::open_in_memory().unwrap();
        ingest_observation(
            &g,
            &CueExtractor,
            &fact("I work with Alice on the eri project"),
        )
        .unwrap();

        let alice = world::entities_of_kind(&g, world::entity_kind::PERSON)
            .unwrap()
            .into_iter()
            .find(|e| e.canonical_name() == "Alice")
            .expect("Alice exists");
        let eri = world::entities_of_kind(&g, world::entity_kind::PROJECT)
            .unwrap()
            .into_iter()
            .find(|e| e.canonical_name() == "eri")
            .expect("eri exists");

        let collaborations =
            world::related(&g, alice.id(), world::relation::COLLABORATES_ON).unwrap();
        assert!(
            collaborations.iter().any(|e| e.id() == eri.id()),
            "Alice should collaborate_on eri"
        );
    }

    #[test]
    fn the_same_person_across_observations_resolves_to_one_entity() {
        // Idempotent resolution (plan §3 "upsert, not dup"): re-seeing a person in
        // a later observation accumulates evidence on the one entity, including
        // across a single-char typo (the world resolver's typo tolerance).
        let g = Graph::open_in_memory().unwrap();
        ingest_observation(
            &g,
            &CueExtractor,
            &fact("I work with Alice on the eri project"),
        )
        .unwrap();
        ingest_observation(
            &g,
            &CueExtractor,
            &fact("Met Alise about the eri project again"),
        )
        .unwrap();

        let alices: Vec<_> = world::entities_of_kind(&g, world::entity_kind::PERSON)
            .unwrap()
            .into_iter()
            .filter(|e| e.canonical_name() == "Alice")
            .collect();
        assert_eq!(alices.len(), 1, "one Alice across observations + typo");
        let evidence = world::evidence_for(&g, alices[0].id()).unwrap();
        assert_eq!(evidence.len(), 2, "both mentions evidence the one Alice");
    }

    /// Stand-in for the base-engine reflection pass: returns a fixed reading the
    /// cue extractor could never derive from the text, proving ingest is driven by
    /// the [`Extractor`] seam (ADR-0007 §3), not by `CueExtractor` specifics.
    struct MockExtractor(Extraction);
    impl Extractor for MockExtractor {
        fn extract(&self, _text: &str) -> Extraction {
            self.0.clone()
        }
    }

    #[test]
    fn ingest_is_driven_by_the_pluggable_extractor() {
        let g = Graph::open_in_memory().unwrap();
        let reading = Extraction {
            entities: vec![
                EntityMention {
                    kind: world::entity_kind::PERSON,
                    name: "Priya".into(),
                },
                EntityMention {
                    kind: world::entity_kind::PROJECT,
                    name: "atlas".into(),
                },
            ],
            relations: vec![RelationMention {
                src: "Priya".into(),
                dst: "atlas".into(),
                relation: world::relation::COLLABORATES_ON,
            }],
        };
        ingest_observation(&g, &MockExtractor(reading), &fact("an opaque note")).unwrap();

        let priya = world::entities_of_kind(&g, world::entity_kind::PERSON)
            .unwrap()
            .into_iter()
            .find(|e| e.canonical_name() == "Priya")
            .expect("Priya from the mock");
        let atlas = world::entities_of_kind(&g, world::entity_kind::PROJECT)
            .unwrap()
            .into_iter()
            .find(|e| e.canonical_name() == "atlas")
            .expect("atlas from the mock");
        let collab = world::related(&g, priya.id(), world::relation::COLLABORATES_ON).unwrap();
        assert!(collab.iter().any(|e| e.id() == atlas.id()));
    }

    #[test]
    fn an_observation_with_no_people_or_projects_fabricates_no_entities() {
        // Memory is "only what's observed, never fabricated" (CONTEXT.md): a plain
        // preference must not hallucinate entities into the world model.
        let g = Graph::open_in_memory().unwrap();
        ingest_observation(&g, &CueExtractor, &fact("I prefer dark mode and tabs")).unwrap();

        assert!(
            world::entities_of_kind(&g, world::entity_kind::PERSON)
                .unwrap()
                .is_empty()
        );
        assert!(
            world::entities_of_kind(&g, world::entity_kind::PROJECT)
                .unwrap()
                .is_empty()
        );
    }
}
