//! The world-model layer over the property graph.
//!
//! eri's world model is one graph (ADR-0007): people, projects, apps and other
//! entities as nodes, relations between them as edges, observations linked to
//! the entities they evidence, all bi-temporal. This module is the typed,
//! deep-module API over the generic [`Graph`] — entity/relation kinds live as
//! strings in the node `kind` / edge `kind` (no schema migration, per the
//! crate design), and entity attributes live in the node body.

use serde_json::{Value, json};

use crate::{Direction, Edge, Graph, GraphError, Node, NodeId};

/// Non-entity world-model node kinds.
pub mod node_kind {
    /// A raw thing eri observed about the user (the episodic record).
    pub const OBSERVATION: &str = "observation";
    /// A behavioral action eri took or observed ("open Safari") — the unit of a
    /// proactive chain. One node per distinct action so transitions accumulate.
    pub const ACTION: &str = "action";
}

/// Entity kinds — the "things" in a person's world.
pub mod entity_kind {
    pub const PERSON: &str = "entity_person";
    pub const PROJECT: &str = "entity_project";
    pub const APP: &str = "entity_app";
    pub const TOPIC: &str = "entity_topic";
    pub const PLACE: &str = "entity_place";
    pub const LIFE_EVENT: &str = "entity_life_event";
}

/// Relation kinds — the edges between entities (and from observations).
pub mod relation {
    pub const WORKS_WITH: &str = "works_with";
    pub const COLLABORATES_ON: &str = "collaborates_on";
    pub const OWNS: &str = "owns";
    pub const USES: &str = "uses";
    pub const PART_OF: &str = "part_of";
    /// Provenance: an observation evidences an entity/relation.
    pub const EVIDENCES: &str = "evidences";
    /// Provenance: a node mentions an entity.
    pub const MENTIONS: &str = "mentions";
    /// Temporal: one action usually follows another (a proactive chain edge). The
    /// edge metadata carries a `count` = how many times the transition was seen.
    pub const NEXT: &str = "next";
}

/// A typed view over an entity node: a thing in the user's world with a
/// canonical name. Wraps the underlying [`Node`]; attributes read from its body.
#[derive(Debug, Clone)]
pub struct Entity {
    node: Node,
}

impl Entity {
    /// The entity kind (one of [`entity_kind`]).
    pub fn kind(&self) -> &str {
        &self.node.kind
    }

    /// The canonical display name eri resolved this entity to.
    pub fn canonical_name(&self) -> &str {
        self.node
            .body
            .get("canonical_name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
    }

    /// Known name variants resolved onto this entity (typos, casings).
    pub fn aliases(&self) -> Vec<String> {
        self.node
            .body
            .get("aliases")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The underlying graph node id.
    pub fn id(&self) -> &NodeId {
        &self.node.id
    }
}

/// A typed view over an observation node: a raw thing eri observed.
#[derive(Debug, Clone)]
pub struct Observation {
    node: Node,
}

impl Observation {
    /// The observed text.
    pub fn text(&self) -> &str {
        self.node
            .body
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
    }

    /// When eri recorded this observation (ms epoch), if the node carries it
    /// (`learned_at`, else `valid_from`, else 0 for a bare observation node).
    pub fn learned_at(&self) -> u64 {
        self.node
            .body
            .get("learned_at")
            .and_then(|v| v.as_u64())
            .or_else(|| self.node.body.get("valid_from").and_then(|v| v.as_u64()))
            .unwrap_or(0)
    }

    /// The underlying graph node id.
    pub fn id(&self) -> &NodeId {
        &self.node.id
    }

    /// The id of the source memory-store observation this node was bridged from
    /// (`graph_bridge::write_observation` stamps `source_id`), if any — the "where
    /// did this come from / forget this" provenance link the memory UI reads off an
    /// entity's evidence. `None` for nodes written without a source (e.g. a bare
    /// [`record_observation`]).
    pub fn source_id(&self) -> Option<&str> {
        self.node.body.get("source_id").and_then(|v| v.as_str())
    }
}

/// Record a raw observation, returning its node id.
pub fn record_observation(graph: &Graph, text: &str) -> Result<NodeId, GraphError> {
    graph.insert_node(Node::new(node_kind::OBSERVATION, json!({ "text": text })))
}

/// Link an observation as evidence for an entity (provenance).
pub fn evidences(graph: &Graph, observation: &NodeId, entity: &NodeId) -> Result<(), GraphError> {
    graph.insert_edge(Edge::new(
        observation.clone(),
        entity.clone(),
        relation::EVIDENCES,
    ))?;
    Ok(())
}

/// Reflection-pass primitive: resolve-or-create the entity named in an
/// observation and attach the observation as evidence, returning the entity id.
/// Re-seeing the same entity (any casing variant) accumulates evidence on the
/// one resolved entity rather than forking a new one.
pub fn link_evidence(
    graph: &Graph,
    observation: &NodeId,
    kind: &str,
    canonical_name: &str,
) -> Result<NodeId, GraphError> {
    let entity = upsert_entity(graph, kind, canonical_name)?;
    evidences(graph, observation, &entity)?;
    Ok(entity)
}

/// Like [`evidences`] but stamps the evidence edge with a `source` tag (e.g.
/// "reflection") — provenance, so model-inferred facts stay distinguishable from
/// directly observed ones (read it from the edge `metadata.source`).
pub fn evidences_with_source(
    graph: &Graph,
    observation: &NodeId,
    entity: &NodeId,
    source: &str,
) -> Result<(), GraphError> {
    graph.insert_edge(
        Edge::new(observation.clone(), entity.clone(), relation::EVIDENCES)
            .with_metadata(json!({ "source": source })),
    )?;
    Ok(())
}

/// Like [`link_evidence`] but stamps the evidence with `source` provenance — the
/// reflection pass's primitive (its facts are model-inferred, not observed).
pub fn link_evidence_with_source(
    graph: &Graph,
    observation: &NodeId,
    kind: &str,
    canonical_name: &str,
    source: &str,
) -> Result<NodeId, GraphError> {
    let entity = upsert_entity(graph, kind, canonical_name)?;
    evidences_with_source(graph, observation, &entity, source)?;
    Ok(entity)
}

/// The observations that evidence `entity`.
pub fn evidence_for(graph: &Graph, entity: &NodeId) -> Result<Vec<Observation>, GraphError> {
    let neighbors = graph.neighbors(entity, Some(relation::EVIDENCES), Direction::In)?;
    Ok(neighbors
        .into_iter()
        .map(|(_edge, node)| Observation { node })
        .collect())
}

/// Record a new entity of `kind` with `canonical_name`, returning its node id.
pub fn record_entity(
    graph: &Graph,
    kind: &str,
    canonical_name: &str,
) -> Result<NodeId, GraphError> {
    let body = json!({
        "canonical_name": canonical_name,
        "aliases": [],
        "attributes": {},
    });
    graph.insert_node(Node::new(kind, body))
}

/// Maximum entities of one kind the resolver scans. Generous for a per-person
/// world model; swap for an indexed lookup if it ever becomes a bottleneck.
const ENTITY_SCAN_LIMIT: usize = 10_000;

/// All entities of `kind`, most-recent first.
pub fn entities_of_kind(graph: &Graph, kind: &str) -> Result<Vec<Entity>, GraphError> {
    Ok(graph
        .query_by_kind(kind, ENTITY_SCAN_LIMIT)?
        .into_iter()
        .map(|node| Entity { node })
        .collect())
}

/// The most recent observation nodes (newest first), capped at `limit` — the
/// batch the cold-path reflection pass reads over.
pub fn recent_observations(graph: &Graph, limit: usize) -> Result<Vec<Observation>, GraphError> {
    Ok(graph
        .query_by_kind(node_kind::OBSERVATION, limit)?
        .into_iter()
        .map(|node| Observation { node })
        .collect())
}

/// Resolve an existing entity of `kind` by exact canonical name or a recorded
/// alias (trim + case-insensitive). Read-only — never creates (the difference
/// from [`upsert_entity`]). Returns `None` when nothing matches.
pub fn find_entity(graph: &Graph, kind: &str, name: &str) -> Result<Option<Entity>, GraphError> {
    let needle = normalize_name(name);
    Ok(entities_of_kind(graph, kind)?
        .into_iter()
        .find(|e| name_matches(e, &needle)))
}

/// Whether `entity`'s canonical name or any alias equals the already-normalized
/// `needle`. The shared exact-match rule for resolution.
fn name_matches(entity: &Entity, needle: &str) -> bool {
    let key = strip_entity_noun(needle);
    strip_entity_noun(&normalize_name(entity.canonical_name())) == key
        || entity
            .aliases()
            .iter()
            .any(|a| strip_entity_noun(&normalize_name(a)) == key)
}

/// Project/app nouns stripped from an entity name for resolution, so "atlas" and
/// "atlas project" resolve to ONE entity. The base-engine reflection pass names
/// projects with their noun ("atlas project") while the cue extractor uses the bare
/// name ("atlas"); without this they'd fork into two entities.
const ENTITY_NAME_NOUNS: &[&str] = &["project", "app", "repo", "codebase", "startup"];

/// Strip a single trailing project/app noun from an already-normalized name (no-op
/// if the name is only the noun, so an entity literally named "project" survives).
fn strip_entity_noun(normalized: &str) -> &str {
    for noun in ENTITY_NAME_NOUNS {
        if let Some(rest) = normalized.strip_suffix(noun) {
            let rest = rest.trim_end();
            if !rest.is_empty() {
                return rest;
            }
        }
    }
    normalized
}

/// Resolve-or-create an entity. Resolution is layered, cheapest-first:
/// 1. **exact** — canonical name or a known alias (trim + case-insensitive);
/// 2. **typo-tolerant** — a one-edit variant of a long name sharing a first
///    letter (records the variant as an alias so it's exact next time);
/// 3. otherwise record a new entity.
///
/// This makes the reflection pass idempotent across casing AND single-char
/// typos. Deliberately conservative on (2) to never merge distinct people; the
/// base-engine reflection pass is the confirmer for harder variants/nicknames.
pub fn upsert_entity(
    graph: &Graph,
    kind: &str,
    canonical_name: &str,
) -> Result<NodeId, GraphError> {
    let needle = normalize_name(canonical_name);
    let entities = entities_of_kind(graph, kind)?;

    // 1. exact match on canonical name or a recorded alias.
    for entity in &entities {
        if name_matches(entity, &needle) {
            return Ok(entity.id().clone());
        }
    }

    // 2. conservative typo match — remember the variant as an alias.
    for entity in &entities {
        if is_typo_variant(&normalize_name(entity.canonical_name()), &needle) {
            add_alias(graph, entity, canonical_name.trim())?;
            return Ok(entity.id().clone());
        }
    }

    // 3. genuinely new entity.
    record_entity(graph, kind, canonical_name.trim())
}

/// Canonical-name normalization for resolution (trim + lowercase).
fn normalize_name(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Whether `b` is a conservative one-edit typo of `a`: both ≥5 chars, same
/// first character, and optimal-string-alignment distance ≤ 1 (covers single
/// insert/delete/substitute/transpose). Short names never fuzzy-merge.
fn is_typo_variant(a: &str, b: &str) -> bool {
    let (la, lb) = (a.chars().count(), b.chars().count());
    la.min(lb) >= 5 && a.chars().next() == b.chars().next() && osa_distance(a, b) <= 1
}

/// Append a resolved name variant to an entity's alias list (read-modify-write
/// its node body) so future lookups hit the exact path.
fn add_alias(graph: &Graph, entity: &Entity, variant: &str) -> Result<(), GraphError> {
    let mut body = entity.node.body.clone();
    match body.get_mut("aliases").and_then(|v| v.as_array_mut()) {
        Some(arr) => {
            if !arr.iter().any(|a| a.as_str() == Some(variant)) {
                arr.push(Value::from(variant));
            }
        }
        None => {
            if let Some(obj) = body.as_object_mut() {
                obj.insert("aliases".into(), json!([variant]));
            }
        }
    }
    graph.update_node_body(entity.id(), &body)
}

/// Optimal string alignment distance (Levenshtein + adjacent transposition).
fn osa_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let (n, m) = (a.len(), b.len());
    if n == 0 {
        return m;
    }
    if m == 0 {
        return n;
    }
    let mut d = vec![vec![0usize; m + 1]; n + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in d[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=n {
        for j in 1..=m {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            let mut v = (d[i - 1][j] + 1)
                .min(d[i][j - 1] + 1)
                .min(d[i - 1][j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                v = v.min(d[i - 2][j - 2] + 1);
            }
            d[i][j] = v;
        }
    }
    d[n][m]
}

/// Relate `src` to `dst` with `relation`, valid from now (open-ended).
pub fn relate(graph: &Graph, src: &NodeId, dst: &NodeId, relation: &str) -> Result<(), GraphError> {
    relate_at(graph, src, dst, relation, now_ms())
}

/// Like [`relate`] but stamps the relation edge with `source` provenance (e.g.
/// "reflection"), valid from now — the reflection pass's relation primitive.
pub fn relate_with_source(
    graph: &Graph,
    src: &NodeId,
    dst: &NodeId,
    relation: &str,
    source: &str,
) -> Result<(), GraphError> {
    let edge = Edge::new(src.clone(), dst.clone(), relation).with_metadata(
        json!({ "valid_from": now_ms(), "valid_to": Value::Null, "source": source }),
    );
    graph.insert_edge(edge)?;
    Ok(())
}

/// Relate `src` to `dst` with `relation`, valid from `valid_from` (open-ended).
/// Bi-temporal: the relation holds from `valid_from` until [`end_relation`]
/// stamps a `valid_to`.
pub fn relate_at(
    graph: &Graph,
    src: &NodeId,
    dst: &NodeId,
    relation: &str,
    valid_from: u64,
) -> Result<(), GraphError> {
    let edge = Edge::new(src.clone(), dst.clone(), relation)
        .with_metadata(json!({ "valid_from": valid_from, "valid_to": Value::Null }));
    graph.insert_edge(edge)?;
    Ok(())
}

/// Mark the active `src --relation--> dst` relation as having stopped being
/// true at `valid_to`. Invalidate-not-delete: the edge stays for as-of recall.
pub fn end_relation(
    graph: &Graph,
    src: &NodeId,
    dst: &NodeId,
    relation: &str,
    valid_to: u64,
) -> Result<(), GraphError> {
    for (edge, node) in graph.neighbors(src, Some(relation), Direction::Out)? {
        if &node.id == dst && edge_valid_to(&edge).is_none() {
            let mut meta = edge.metadata.clone();
            if !meta.is_object() {
                meta = json!({});
            }
            if let Some(obj) = meta.as_object_mut() {
                obj.insert("valid_to".into(), Value::from(valid_to));
            }
            graph.update_edge_metadata(&edge.id, &meta)?;
        }
    }
    Ok(())
}

/// Entities reached from `src` along `relation` edges that are currently valid.
pub fn related(graph: &Graph, src: &NodeId, relation: &str) -> Result<Vec<Entity>, GraphError> {
    related_as_of(graph, src, relation, now_ms())
}

/// Entities reached from `src` along `relation` edges that were valid at `at`
/// (bi-temporal): `valid_from <= at` and (`valid_to` is unset or `at < valid_to`).
pub fn related_as_of(
    graph: &Graph,
    src: &NodeId,
    relation: &str,
    at: u64,
) -> Result<Vec<Entity>, GraphError> {
    let neighbors = graph.neighbors(src, Some(relation), Direction::Out)?;
    Ok(neighbors
        .into_iter()
        .filter(|(edge, _)| edge_valid_at(edge, at))
        .map(|(_edge, node)| Entity { node })
        .collect())
}

/// Entities pointing INTO `dst` along currently-valid `relation` edges — the
/// inverse of [`related`]. Answers "who collaborates on this project?": the
/// person is the edge source, the project is `dst`.
pub fn related_in(graph: &Graph, dst: &NodeId, relation: &str) -> Result<Vec<Entity>, GraphError> {
    let at = now_ms();
    let neighbors = graph.neighbors(dst, Some(relation), Direction::In)?;
    Ok(neighbors
        .into_iter()
        .filter(|(edge, _)| edge_valid_at(edge, at))
        .map(|(_edge, node)| Entity { node })
        .collect())
}

// ── Proactive chains (Q16): weighted "next" paths between actions ──

/// An action node's label (the behavior it represents).
fn action_label(node: &Node) -> &str {
    node.body
        .get("label")
        .and_then(|v| v.as_str())
        .unwrap_or("")
}

/// Resolve-or-create the action node for `label` (trim + case-insensitive), so
/// one node per distinct action accumulates its transition edges.
pub fn record_action(graph: &Graph, label: &str) -> Result<NodeId, GraphError> {
    let needle = normalize_name(label);
    if let Some(id) = find_action(graph, &needle)? {
        return Ok(id);
    }
    graph.insert_node(Node::new(
        node_kind::ACTION,
        json!({ "label": label.trim() }),
    ))
}

/// The action node whose normalized label equals `needle` (already normalized).
fn find_action(graph: &Graph, needle: &str) -> Result<Option<NodeId>, GraphError> {
    Ok(graph
        .query_by_kind(node_kind::ACTION, ENTITY_SCAN_LIMIT)?
        .into_iter()
        .find(|n| normalize_name(action_label(n)) == needle)
        .map(|n| n.id))
}

/// Record that `to_label` followed `from_label`: create or strengthen the
/// weighted `NEXT` edge between their action nodes (the metadata `count` is how
/// many times the transition was seen). The proactive-chain primitive. A
/// self-transition (`from == to`) is ignored — the graph has no self-edges.
pub fn link_next(graph: &Graph, from_label: &str, to_label: &str) -> Result<(), GraphError> {
    let from = record_action(graph, from_label)?;
    let to = record_action(graph, to_label)?;
    if from == to {
        return Ok(());
    }
    for (edge, node) in graph.neighbors(&from, Some(relation::NEXT), Direction::Out)? {
        if node.id == to {
            let count = next_count(&edge) + 1;
            let mut meta = edge.metadata.clone();
            if !meta.is_object() {
                meta = json!({});
            }
            if let Some(obj) = meta.as_object_mut() {
                obj.insert("count".into(), Value::from(count));
            }
            return graph.update_edge_metadata(&edge.id, &meta);
        }
    }
    graph.insert_edge(Edge::new(from, to, relation::NEXT).with_metadata(json!({ "count": 1 })))?;
    Ok(())
}

/// The transition count recorded on a `NEXT` edge (defaults to 1 for legacy edges
/// without the field).
fn next_count(edge: &Edge) -> u64 {
    edge.metadata
        .get("count")
        .and_then(Value::as_u64)
        .unwrap_or(1)
}

/// Successor actions ranked by how often they followed `label` — "after X you
/// usually Y" (Q16). Returns `(label, count)` best-first (ties broken by label
/// for determinism), capped at `limit`. Unknown action → empty.
pub fn next_steps(
    graph: &Graph,
    label: &str,
    limit: usize,
) -> Result<Vec<(String, u64)>, GraphError> {
    let needle = normalize_name(label);
    let Some(from) = find_action(graph, &needle)? else {
        return Ok(Vec::new());
    };
    let mut steps: Vec<(String, u64)> = graph
        .neighbors(&from, Some(relation::NEXT), Direction::Out)?
        .into_iter()
        .map(|(edge, node)| (action_label(&node).to_string(), next_count(&edge)))
        .collect();
    steps.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    steps.truncate(limit);
    Ok(steps)
}

// ── Predict substrate (ADR-0007 §4): what the world model anticipates ──

/// The transition count at which a `next` step counts as an **established**
/// pattern the world model anticipates — the same threshold the proactive hint
/// uses, so "what eri suggests" and "what eri vouches for" stay in step.
pub const ESTABLISHED_TRANSITIONS: u64 = 2;

/// How many successors of one action to scan when checking expectation (an
/// action has few; a generous cap).
const NEXT_LOOKUP_LIMIT: usize = 64;

/// Every entity kind, for the cross-kind grounding scan.
pub const ENTITY_KINDS: [&str; 6] = [
    entity_kind::PERSON,
    entity_kind::PROJECT,
    entity_kind::APP,
    entity_kind::TOPIC,
    entity_kind::PLACE,
    entity_kind::LIFE_EVENT,
];

/// The minimum entity-name length (in chars, separators excluded) eligible for
/// grounding, so a very short name can't spuriously match a stray word.
const MIN_GROUND_CHARS: usize = 3;

/// What the world model anticipates about an action about to run: was it an
/// **established** next-step after `prev` (the proactive *chain*), and does its
/// text/`target` name a known entity (the *entity* model). The two signals
/// joined — both read from the one graph — are the substrate the predict step
/// (eri_cli) blends into the confirmation envelope's confidence (ADR-0007 §4).
/// Neutral (`false, false`) means nothing is anticipated, so the predict step
/// falls back to the engine's own confidence.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Expectation {
    /// `action_label` is an established successor of `prev` (count ≥ threshold).
    pub expected: bool,
    /// The action's text or `target` names a known entity ("who/what is X").
    pub grounded: bool,
}

/// Compute the world model's [`Expectation`] for an action `action_label`
/// following `prev` (the previously executed action, if any), optionally with an
/// explicit `target` string to ground (e.g. the focused app). Read-only.
pub fn expectation(
    graph: &Graph,
    prev: Option<&str>,
    action_label: &str,
    target: Option<&str>,
) -> Result<Expectation, GraphError> {
    let expected = match prev {
        Some(p) => {
            let want = normalize_name(action_label);
            next_steps(graph, p, NEXT_LOOKUP_LIMIT)?
                .into_iter()
                .any(|(label, count)| {
                    count >= ESTABLISHED_TRANSITIONS && normalize_name(&label) == want
                })
        }
        None => false,
    };
    let grounded = mentions_known_entity(graph, action_label)?
        || match target {
            Some(t) => mentions_known_entity(graph, t)?,
            None => false,
        };
    Ok(Expectation { expected, grounded })
}

/// Whether `text` names a known entity of any kind — the action's target matched
/// to the entity model ("who/what is X"). A name grounds when its word(s) appear
/// as a contiguous, case-insensitive **whole-word** run in `text`, by canonical
/// name or alias. The grounding half of [`expectation`].
pub fn mentions_known_entity(graph: &Graph, text: &str) -> Result<bool, GraphError> {
    let hay = tokenize(text);
    if hay.is_empty() {
        return Ok(false);
    }
    for kind in ENTITY_KINDS {
        for entity in entities_of_kind(graph, kind)? {
            if name_grounds(&hay, entity.canonical_name())
                || entity.aliases().iter().any(|a| name_grounds(&hay, a))
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Lowercase alphanumeric word tokens of `s`.
fn tokenize(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_lowercase())
        .collect()
}

/// Whether `name`'s tokens appear as a contiguous run within `hay` (the text's
/// tokens) and the name clears [`MIN_GROUND_CHARS`].
fn name_grounds(hay: &[String], name: &str) -> bool {
    let needle = tokenize(name);
    if needle.is_empty() {
        return false;
    }
    let chars: usize = needle.iter().map(|t| t.chars().count()).sum();
    if chars < MIN_GROUND_CHARS {
        return false;
    }
    hay.windows(needle.len()).any(|w| w == needle.as_slice())
}

/// Every established proactive chain ("after X you usually Y", count ≥
/// [`ESTABLISHED_TRANSITIONS`]), most-frequent first, capped at `limit` — the
/// prediction slice of the recall projection (ADR-0010). Returns `(after, next,
/// count)`.
pub fn established_chains(
    graph: &Graph,
    limit: usize,
) -> Result<Vec<(String, String, u64)>, GraphError> {
    let mut out: Vec<(String, String, u64)> = Vec::new();
    for node in graph.query_by_kind(node_kind::ACTION, ENTITY_SCAN_LIMIT)? {
        let from = action_label(&node).to_string();
        if from.is_empty() {
            continue;
        }
        for (to, count) in next_steps(graph, &from, NEXT_LOOKUP_LIMIT)? {
            if count >= ESTABLISHED_TRANSITIONS {
                out.push((from.clone(), to, count));
            }
        }
    }
    out.sort_by(|a, b| {
        b.2.cmp(&a.2)
            .then_with(|| (a.0.as_str(), a.1.as_str()).cmp(&(b.0.as_str(), b.1.as_str())))
    });
    out.truncate(limit);
    Ok(out)
}

/// Down-weight the learned chain `from_label` → `to_label` — reduce its
/// transition count by one (it misfired). The sia loop's chain-refine op (P3): a
/// decremented count weakens the "after X you usually Y" corroboration, and at 0
/// it no longer reads as established. Stamps the edge `source = "sia"` for
/// provenance (auditable). No-op if the transition was never learned. Reduces,
/// never deletes — reversible.
pub fn downweight_next(graph: &Graph, from_label: &str, to_label: &str) -> Result<(), GraphError> {
    let Some(from) = find_action(graph, &normalize_name(from_label))? else {
        return Ok(());
    };
    let to_needle = normalize_name(to_label);
    for (edge, node) in graph.neighbors(&from, Some(relation::NEXT), Direction::Out)? {
        if normalize_name(action_label(&node)) == to_needle {
            let count = next_count(&edge).saturating_sub(1);
            let mut meta = edge.metadata.clone();
            if !meta.is_object() {
                meta = json!({});
            }
            if let Some(obj) = meta.as_object_mut() {
                obj.insert("count".into(), Value::from(count));
                obj.insert("source".into(), Value::from("sia"));
            }
            return graph.update_edge_metadata(&edge.id, &meta);
        }
    }
    Ok(())
}

fn edge_valid_at(edge: &Edge, at: u64) -> bool {
    let from = edge
        .metadata
        .get("valid_from")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let to = edge_valid_to(edge);
    at >= from && to.is_none_or(|t| at < t)
}

fn edge_valid_to(edge: &Edge) -> Option<u64> {
    edge.metadata.get("valid_to").and_then(Value::as_u64)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
