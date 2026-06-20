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

    /// The underlying graph node id.
    pub fn id(&self) -> &NodeId {
        &self.node.id
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
    normalize_name(entity.canonical_name()) == needle
        || entity.aliases().iter().any(|a| normalize_name(a) == needle)
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
