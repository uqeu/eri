//! Entity-aware recall over the world-model graph (ADR-0007, slice-1 Step 4).
//!
//! Additive: reads the entities/relations [`extraction::ingest_observation`]
//! wrote into `eri_graph` and answers people/project questions — most directly
//! "**who do I work with on X?**" — plus emits the Tier-A "Key People / Active
//! Projects" block. It *blends with* (never replaces) the observation recall in
//! [`MemoryStore`](super::MemoryStore): this is the world-model layer beside the
//! episodic log, so callers concatenate this block with the existing
//! [`format_learned_block`](super::format_learned_block) injection.
//!
//! Ranking is by **salience** — how many observations evidence an entity — a
//! co-occurrence proxy. Recency weighting is a later refinement.

use std::io;
use std::path::PathBuf;

use eri_graph::{Graph, GraphError, world};
use world::Entity;

use super::Observation;
use super::extraction::{CueExtractor, ingest_observation};

// --- integration facade -------------------------------------------------------
// Encapsulates `eri_graph` behind a user-scoped, best-effort API so call sites
// (the sidecar `remember`/`patterns` arms, the MCP/CLI remember tools) wire the
// world model in one line and never name `eri_graph`. The world graph sits
// beside the per-user memory store, so people/projects span every workspace.

/// Path to the user's world-model graph — user-scoped like the memory store, so
/// people/projects span every workspace. It sits beside `memory.json`:
/// `Some(uid)` → `~/.eri/users/<partition>/world.sqlite`; `None` →
/// `~/.eri/world.sqlite`. (Thin glue over [`memory_path_for`](super::memory_path_for);
/// the graph mechanics are covered by `eri_graph`'s `open_at` test and the world
/// recall/extraction tests below.)
pub fn world_graph_path_for(user_id: Option<&str>) -> io::Result<PathBuf> {
    Ok(super::memory_path_for(user_id)?.with_file_name("world.sqlite"))
}

/// Open (or create) the user's world-model graph.
pub fn open_world_graph(user_id: Option<&str>) -> io::Result<Graph> {
    let path = world_graph_path_for(user_id)?;
    Graph::open_at(&path).map_err(|e| io::Error::other(format!("open world graph: {e}")))
}

/// Ingest an already-stored observation into the user's world model (additive).
/// Opens the user's world graph and runs the cue extractor. Callers treat the
/// result as **best-effort** — a world-model failure must never fail the memory
/// write that triggered it.
pub fn model_observation(user_id: Option<&str>, obs: &Observation) -> io::Result<()> {
    let graph = open_world_graph(user_id)?;
    ingest_observation(&graph, &CueExtractor, obs)
        .map_err(|e| io::Error::other(format!("world ingest: {e}")))?;
    Ok(())
}

/// The Tier-A "Key People / Active Projects" block for the user's world model,
/// or `""` when it is empty or unavailable. Blends with
/// [`format_learned_block`](super::format_learned_block); best-effort, so a
/// world-model error simply contributes nothing to the prompt.
pub fn world_block_for(user_id: Option<&str>, limit: usize) -> String {
    let Ok(graph) = open_world_graph(user_id) else {
        return String::new();
    };
    let people = key_people(&graph, limit).unwrap_or_default();
    let projects = key_projects(&graph, limit).unwrap_or_default();
    format_world_block(&people, &projects)
}

/// Record that one action followed another into the user's world model — the
/// proactive-chain **observe** step (Q16): it strengthens the weighted `next`
/// edge between the two actions. Best-effort for the caller: the chain enriches
/// prediction, it is not a precondition for the action itself.
pub fn observe_transition(user_id: Option<&str>, from: &str, to: &str) -> io::Result<()> {
    let graph = open_world_graph(user_id)?;
    world::link_next(&graph, from, to).map_err(|e| io::Error::other(format!("link_next: {e}")))
}

/// "After X you usually Y" — the successor actions for `action`, ranked by how
/// often they followed it (Q16). Best-effort: an empty list on cold start or any
/// error, so a missing world model simply yields no proactive suggestion.
pub fn predict_next(user_id: Option<&str>, action: &str, limit: usize) -> Vec<(String, u64)> {
    let Ok(graph) = open_world_graph(user_id) else {
        return Vec::new();
    };
    world::next_steps(&graph, action, limit).unwrap_or_default()
}

/// An **opened, reusable handle** on the user's world model — the predict step's
/// reader (P2, ADR-0007 §4).
///
/// Opening the world-model SQLite is amortized to **once per control run**
/// instead of once per gated action: the control gate (`eri_cli`) holds this
/// handle and reads through it on every action, so the predict→gate hot path is
/// a query, not an open. The seam stays in `eri_inference::memory` per ADR-0007 —
/// callers never name `eri_graph`. Best-effort by construction: [`open`](Self::open)
/// is `None` when the user has no world model yet, and [`anticipate`](Self::anticipate)
/// is neutral on a read error, so the predict step falls back to the engine's
/// own confidence.
pub struct WorldModel {
    graph: Graph,
}

impl std::fmt::Debug for WorldModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The handle is opaque — don't print the underlying graph/connection.
        f.debug_struct("WorldModel").finish_non_exhaustive()
    }
}

impl WorldModel {
    /// Open the signed-in user's world model (`None` = anonymous or unopenable).
    /// Called once per run; the handle is then reused for every action.
    pub fn open(user_id: Option<&str>) -> Option<Self> {
        open_world_graph(user_id).ok().map(|graph| Self { graph })
    }

    /// Wrap an already-open graph — the in-memory seam for tests (no HOME IO).
    pub fn from_graph(graph: Graph) -> Self {
        Self { graph }
    }

    /// What the world model anticipates about an action about to run — joins the
    /// proactive **chain** (`prev` → `action_label`) with the **entity** model
    /// (does the action name a known entity), both from the one user graph.
    /// Reads through the held handle (no reopen); neutral (`expected=false,
    /// grounded=false`) on any read error.
    pub fn anticipate(
        &self,
        prev: Option<&str>,
        action_label: &str,
        target: Option<&str>,
    ) -> world::Expectation {
        world::expectation(&self.graph, prev, action_label, target).unwrap_or_default()
    }
}

// --- world-model queries ------------------------------------------------------

/// People who collaborate on the named project — "who do I work with on X?".
/// Resolves the project by name (exact/alias, case-insensitive); an unknown
/// project yields an empty list (never fabricates). Canonical names,
/// most-salient first.
pub fn who_collaborates_on(graph: &Graph, project: &str) -> Result<Vec<String>, GraphError> {
    let Some(proj) = world::find_entity(graph, world::entity_kind::PROJECT, project)? else {
        return Ok(Vec::new());
    };
    let people = world::related_in(graph, proj.id(), world::relation::COLLABORATES_ON)?;
    Ok(names(ranked_by_salience(graph, dedup_by_id(people))?))
}

/// Keep the first occurrence of each entity id. `related_in` yields one result
/// per edge, so a person who collaborates on a project across several
/// observations would otherwise appear once per edge.
fn dedup_by_id(entities: Vec<Entity>) -> Vec<Entity> {
    let mut seen = std::collections::HashSet::new();
    entities
        .into_iter()
        .filter(|e| seen.insert(e.id().clone()))
        .collect()
}

/// The user's key people — entities ranked by salience (evidence count),
/// capped at `limit`. The "Key People" half of the Tier-A world block.
pub fn key_people(graph: &Graph, limit: usize) -> Result<Vec<String>, GraphError> {
    top_entities(graph, world::entity_kind::PERSON, limit)
}

/// The user's active projects — entities ranked by salience, capped at `limit`.
pub fn key_projects(graph: &Graph, limit: usize) -> Result<Vec<String>, GraphError> {
    top_entities(graph, world::entity_kind::PROJECT, limit)
}

fn top_entities(graph: &Graph, kind: &str, limit: usize) -> Result<Vec<String>, GraphError> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let mut ranked = ranked_by_salience(graph, world::entities_of_kind(graph, kind)?)?;
    ranked.truncate(limit);
    Ok(names(ranked))
}

/// The Tier-A "Key People / Active Projects" block for system-prompt injection —
/// blended alongside [`format_learned_block`](super::format_learned_block).
/// Empty string when the world model is empty, so it contributes nothing until
/// eri has actually observed people/projects (mirrors `format_learned_block`).
pub fn format_world_block(people: &[String], projects: &[String]) -> String {
    if people.is_empty() && projects.is_empty() {
        return String::new();
    }
    let mut buf = String::from("## Key People / Active Projects\n");
    if !people.is_empty() {
        buf.push_str(&format!("People: {}\n", people.join(", ")));
    }
    if !projects.is_empty() {
        buf.push_str(&format!("Projects: {}\n", projects.join(", ")));
    }
    buf
}

/// Order entities by salience (evidence count) descending, breaking ties by
/// canonical name so the ranking is deterministic.
fn ranked_by_salience(graph: &Graph, entities: Vec<Entity>) -> Result<Vec<Entity>, GraphError> {
    let mut scored: Vec<(Entity, usize)> = Vec::with_capacity(entities.len());
    for e in entities {
        let salience = world::evidence_for(graph, e.id())?.len();
        scored.push((e, salience));
    }
    scored.sort_by(|a, b| {
        b.1.cmp(&a.1)
            .then_with(|| a.0.canonical_name().cmp(b.0.canonical_name()))
    });
    Ok(scored.into_iter().map(|(e, _)| e).collect())
}

fn names(entities: Vec<Entity>) -> Vec<String> {
    entities
        .into_iter()
        .map(|e| e.canonical_name().to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::Observation;
    use crate::memory::extraction::{CueExtractor, ingest_observation};

    fn fact(body: &str) -> Observation {
        Observation {
            kind: "fact".into(),
            body: body.into(),
            ..Default::default()
        }
    }

    #[test]
    fn world_model_handle_anticipates_chain_and_entity_over_one_open() {
        let g = Graph::open_in_memory().unwrap();
        // An established step ("open editor" → "run tests", seen twice) and a
        // known project, in the one graph.
        world::link_next(&g, "open editor", "run tests").unwrap();
        world::link_next(&g, "open editor", "run tests").unwrap();
        ingest_observation(
            &g,
            &CueExtractor,
            &fact("I work with Alice on the eri project"),
        )
        .unwrap();

        // One opened handle, reused across reads — no reopen per call.
        let world = WorldModel::from_graph(g);
        assert!(
            world
                .anticipate(Some("open editor"), "run tests", None)
                .expected,
            "an established chain step is anticipated through the handle"
        );
        assert!(
            world
                .anticipate(None, "open the eri project", None)
                .grounded,
            "a known entity named in the action grounds through the handle"
        );
        let neutral = world.anticipate(None, "click the Save button", None);
        assert!(!neutral.expected && !neutral.grounded);
    }

    #[test]
    fn answers_who_i_work_with_on_a_project() {
        let g = Graph::open_in_memory().unwrap();
        ingest_observation(
            &g,
            &CueExtractor,
            &fact("I work with Alice on the eri project"),
        )
        .unwrap();

        let people = who_collaborates_on(&g, "eri").unwrap();
        assert_eq!(people, vec!["Alice".to_string()]);
    }

    #[test]
    fn an_unknown_project_yields_no_collaborators_and_resolution_is_case_insensitive() {
        let g = Graph::open_in_memory().unwrap();
        ingest_observation(
            &g,
            &CueExtractor,
            &fact("I work with Alice on the eri project"),
        )
        .unwrap();

        assert!(
            who_collaborates_on(&g, "nonexistent").unwrap().is_empty(),
            "an unknown project must not fabricate collaborators"
        );
        assert_eq!(
            who_collaborates_on(&g, "ERI").unwrap(),
            vec!["Alice".to_string()],
            "project resolution is case-insensitive"
        );
    }

    #[test]
    fn each_collaborator_is_listed_once_and_ranked_by_salience() {
        let g = Graph::open_in_memory().unwrap();
        // Alice collaborates on eri across two observations (two edges); Bob once.
        ingest_observation(
            &g,
            &CueExtractor,
            &fact("I work with Alice on the eri project"),
        )
        .unwrap();
        ingest_observation(
            &g,
            &CueExtractor,
            &fact("I collaborate with Alice on the eri project"),
        )
        .unwrap();
        ingest_observation(
            &g,
            &CueExtractor,
            &fact("I build with Bob on the eri project"),
        )
        .unwrap();

        let people = who_collaborates_on(&g, "eri").unwrap();
        assert_eq!(
            people,
            vec!["Alice".to_string(), "Bob".to_string()],
            "Alice listed once, ranked first by salience (more evidence)"
        );
    }

    #[test]
    fn key_people_and_projects_are_ranked_by_salience_and_capped() {
        let g = Graph::open_in_memory().unwrap();
        ingest_observation(
            &g,
            &CueExtractor,
            &fact("I work with Alice on the eri project"),
        )
        .unwrap();
        ingest_observation(&g, &CueExtractor, &fact("Met Alice about the eri project")).unwrap();
        ingest_observation(
            &g,
            &CueExtractor,
            &fact("I build with Bob on the atlas project"),
        )
        .unwrap();

        // Alice (2 mentions) outranks Bob (1); cap keeps the top.
        assert_eq!(
            key_people(&g, 10).unwrap(),
            vec!["Alice".to_string(), "Bob".to_string()]
        );
        assert_eq!(key_people(&g, 1).unwrap(), vec!["Alice".to_string()]);

        // eri (2 mentions) is the most active project.
        let projects = key_projects(&g, 10).unwrap();
        assert_eq!(projects.first(), Some(&"eri".to_string()));
        assert!(projects.contains(&"atlas".to_string()));
    }

    #[test]
    fn the_json_store_and_the_world_graph_answer_together() {
        // The additive design end-to-end (slice-1 demo): the episodic MemoryStore
        // (JSON) records the fact unchanged, AND the same observation populates the
        // world graph so eri answers "who do I work with on X" + Key People/Projects.
        use crate::memory::MemoryStore;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let ws = dir.path();
        let mut store = MemoryStore::open_at(dir.path().join("memory.json")).unwrap();
        let g = Graph::open_in_memory().unwrap();

        let obs = store
            .insert("fact", ws, "I work with Alice on the eri project")
            .unwrap();
        ingest_observation(&g, &CueExtractor, &obs).unwrap();

        // The JSON store is untouched — its recall still works.
        assert!(
            store
                .recall("Alice", ws, 5)
                .iter()
                .any(|o| o.body.contains("Alice")),
            "the episodic store still answers keyword recall"
        );
        // The world graph answers the entity question the flat store never could.
        assert_eq!(
            who_collaborates_on(&g, "eri").unwrap(),
            vec!["Alice".to_string()]
        );
        assert!(key_people(&g, 5).unwrap().contains(&"Alice".to_string()));
        assert!(key_projects(&g, 5).unwrap().contains(&"eri".to_string()));
    }

    #[test]
    fn the_tier_a_world_block_lists_entities_and_is_empty_when_there_is_nothing() {
        // Blends with format_learned_block: contributes nothing until eri has
        // observed people/projects.
        assert_eq!(format_world_block(&[], &[]), "");

        let block = format_world_block(
            &["Alice".to_string(), "Bob".to_string()],
            &["eri".to_string()],
        );
        assert!(block.starts_with("## Key People / Active Projects"));
        assert!(block.contains("People: Alice, Bob"));
        assert!(block.contains("Projects: eri"));
    }
}
