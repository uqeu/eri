//! The recall seam (ADR-0010): a **bounded, server-readable projection** of the
//! world model that the serverless phone reads — and the **fail-closed egress
//! gate** that is the confidential→server-readable boundary.
//!
//! The phone never calls the brain live; the brain pre-computes this projection
//! and pushes it to the server-readable Tier-A store, and the phone reads the
//! last-pushed copy (eventually-consistent; deep/live questions relay to the
//! running computer — ADR-0010 §3/§4). Only this small slice is server-readable;
//! the full graph stays Tier-B/confidential.
//!
//! The projection is the only world-model content that crosses the boundary, so
//! [`may_project`] — the gate that decides what enters it — has **refusal-grade**
//! rigor: it is fail-closed (anything sensitive, or anything uncertain, NEVER
//! enters), reuses the one canonical sensitivity screen ([`profile::looks_sensitive`],
//! no copy), and is **parameterized by [`Recipient`]** so a future consented
//! outward projection (eri-social) extends THIS gate rather than adding a second
//! egress path. Today the only recipient is the user's own devices.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use eri_graph::{Graph, world};

use super::cloud::EriApiClient;
use super::profile::{self, Profile};
use super::sync::SyncError;

/// Who a projection may leave the confidential boundary FOR (ADR-0010 §7). Today
/// only the user's own devices; a future consented outward recipient (a specific
/// person/eri) is a STRICTER policy on this same gate, never a new egress path.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Recipient {
    /// The user's own devices (self) — the only egress today.
    OwnDevices,
}

/// An entity in the projection — a thing in the user's world.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProjectedEntity {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub salience: u64,
}

/// A relation between two projected entities (referenced by `name`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectedRelation {
    pub src: String,
    pub dst: String,
    pub kind: String,
}

/// A recent observation in the live "right now" slice.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProjectedObservation {
    pub text: String,
    pub ts: u64,
    pub kind: String,
}

/// A learned "after X you usually Y" chain step.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectedPrediction {
    pub after: String,
    pub next: String,
    pub count: u64,
}

/// The recall projection (ADR-0010 §1) — the read contract the phone consumes.
/// Single-principal: bound to one `user_id`. `as_of` is when the brain last
/// pushed it (eventually-consistent — the phone answers from this, deep/live
/// questions relay).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct RecallProjection {
    pub version: u32,
    pub user_id: Option<String>,
    pub as_of: u64,
    pub entities: Vec<ProjectedEntity>,
    pub relations: Vec<ProjectedRelation>,
    pub recent_observations: Vec<ProjectedObservation>,
    pub predictions: Vec<ProjectedPrediction>,
    pub profile: Profile,
}

/// The current projection schema version.
pub const PROJECTION_VERSION: u32 = 1;

/// The egress gate (ADR-0010 §5/§7): may `text` leave the confidential boundary
/// FOR `recipient`? **Fail-closed** — sensitive content (the Q23 privacy zones, or
/// anything the canonical screen flags) NEVER passes. The single sensitivity floor
/// ([`profile::looks_sensitive`]) is reused, not copied (one source of truth, like
/// the refusal classifier). A future outward recipient ANDs a stricter screen +
/// consent check here; it never bypasses this floor.
pub fn may_project(text: &str, recipient: Recipient) -> bool {
    match recipient {
        // Server-readable even for the user's own devices (Tier-A is at-rest, not
        // E2E), so the floor applies to OwnDevices already.
        Recipient::OwnDevices => !profile::looks_sensitive(text),
    }
}

/// Apply the egress gate to a fully-assembled projection FOR `recipient`: drop any
/// entity / observation / prediction whose text doesn't pass [`may_project`], then
/// drop relations left dangling (an endpoint that didn't pass) — so a sensitive
/// thing can never appear, even indirectly via an edge. Idempotent.
pub fn gate(projection: &mut RecallProjection, recipient: Recipient) {
    projection
        .entities
        .retain(|e| may_project(&e.name, recipient));
    let kept: std::collections::HashSet<&str> = projection
        .entities
        .iter()
        .map(|e| e.name.as_str())
        .collect();
    // A relation survives only if BOTH endpoints survived the gate (no edge to a
    // dropped — possibly sensitive — entity) and its own kind text passes.
    projection
        .relations
        .retain(|r| kept.contains(r.src.as_str()) && kept.contains(r.dst.as_str()));
    projection
        .recent_observations
        .retain(|o| may_project(&o.text, recipient));
    projection
        .predictions
        .retain(|p| may_project(&p.after, recipient) && may_project(&p.next, recipient));
    // The Tier-A profile is already screened by `distill`, but re-screen its free
    // text defensively — the projection is the boundary, so it gates everything.
    projection
        .profile
        .facts
        .retain(|f| may_project(f, recipient));
    projection
        .profile
        .preferences
        .retain(|p| may_project(p, recipient));
    if !may_project(&projection.profile.dynamic_context, recipient) {
        projection.profile.dynamic_context.clear();
    }
}

// NOTE: the live push trigger is a coordinated step with the phone window — see
// docs/contracts/recall-projection-contract.md "Push integration". The server must
// confirm it ignores unknown fields (then push the ProfileBody-superset to the
// existing endpoint) or stand up a sibling endpoint with the SAME K_server + AAD,
// so we never break the working Tier-A profile sync. push_recall is ready either way.

/// How much of each slice the projection carries — keeps it Tier-A-small.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub entities: usize,
    pub relations: usize,
    pub observations: usize,
    pub predictions: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            entities: 50,
            relations: 100,
            observations: 30,
            predictions: 30,
        }
    }
}

/// Assemble + gate the recall projection from ONE world graph. Reads only this
/// graph, so the projection contains only this graph's world — per-user isolation
/// is by construction (the facade opens the signed-in user's own graph). Every
/// field passes through the egress [`gate`] before it returns.
pub fn project_from_graph(
    graph: &Graph,
    recipient: Recipient,
    now_ms: u64,
    limits: &Limits,
) -> RecallProjection {
    let entities = gather_entities(graph, limits.entities);
    let relations = gather_relations(graph, &entities, limits.relations);
    let recent_observations = gather_recent_observations(graph, limits.observations);
    let predictions = gather_predictions(graph, limits.predictions);
    let mut projection = RecallProjection {
        version: PROJECTION_VERSION,
        user_id: None,
        as_of: now_ms,
        entities,
        relations,
        recent_observations,
        predictions,
        profile: Profile::default(),
    };
    // The boundary gates EVERYTHING before it leaves (defence in depth — even
    // though gather already only reads the user's graph).
    gate(&mut projection, recipient);
    projection
}

/// The user-scoped facade (ADR-0010 §2/§6): open the SIGNED-IN user's world graph
/// and memory, then project them FOR `recipient`. **Single-principal** — it opens
/// only `user_id`'s stores, so a projection can never contain another user's
/// world. Best-effort: an unopenable store simply contributes nothing.
pub fn recall_projection(
    user_id: Option<&str>,
    recipient: Recipient,
    now_ms: u64,
) -> RecallProjection {
    // World-model fields, from the user's own world graph.
    let mut projection = match super::world_recall::open_world_graph(user_id) {
        Ok(graph) => project_from_graph(&graph, recipient, now_ms, &Limits::default()),
        Err(_) => RecallProjection {
            version: PROJECTION_VERSION,
            as_of: now_ms,
            ..Default::default()
        },
    };
    projection.user_id = user_id.map(str::to_string);
    // Compose the Tier-A profile (§6 "the existing profile alongside") from the
    // user's own memory — `distill` already screens it via the same `looks_sensitive`.
    if let Ok(store) = super::MemoryStore::open_for(user_id) {
        projection.profile = super::profile::distill(&store.all(), now_ms);
    }
    // Defence in depth: gate the FULLY composed projection (world fields + profile)
    // once more before it can leave. Nothing crosses the boundary ungated.
    gate(&mut projection, recipient);
    projection
}

/// Path of the **sibling** recall endpoint — distinct from the Tier-A profile route
/// on purpose. The profile PUT is *lossy* (it stores only `body.profile`, silently
/// dropping every top-level world-model field), so the projection rides its own path
/// with the SAME server-side `K_server`-at-rest encryption + AAD=`user_id` (ADR-0010
/// §2). Confirmed with the phone window before wiring (the contract's "Push integration").
const RECALL_PATH: &str = "/api/v1/memory/recall";

/// The recall upload seam — a SEPARATE type from
/// [`super::profile_sync::ProfileTransport`] so [`push_recall`] can never be handed
/// the (lossy) profile transport by mistake; the wrong endpoint is unrepresentable.
/// Carries the already-shaped JSON body; the transport has no opinion on its shape.
pub trait RecallTransport {
    fn upload(&self, body: &str) -> Result<(), SyncError>;
}

/// Production transport: a thin adapter over [`EriApiClient`] targeting
/// [`RECALL_PATH`] — the same client backing the Tier-A/Tier-B transports, not a
/// second copy of the plumbing.
pub struct HttpRecallTransport {
    client: EriApiClient,
}

impl HttpRecallTransport {
    pub fn new(api_base: impl Into<String>, bearer: impl Into<String>) -> Self {
        Self {
            client: EriApiClient::with_base(api_base, bearer),
        }
    }

    /// Adapt an already-built client (so one `EriApiClient` can back every transport
    /// for a session).
    pub fn from_client(client: EriApiClient) -> Self {
        Self { client }
    }
}

impl RecallTransport for HttpRecallTransport {
    fn upload(&self, body: &str) -> Result<(), SyncError> {
        self.client.put_json(RECALL_PATH, body)
    }
}

/// The exact §1 wire body the `/memory/recall` route validates
/// (`coerceRecallProjection`): **camelCase** keys, no `userId` (the server binds it
/// from auth). Shaped separately from the internal [`RecallProjection`] so the wire
/// contract is explicit and immune to internal struct churn — the same discipline as
/// the profile body. A snake_case key here is silently coerced to empty on the phone
/// (the precise silent-drop the sibling endpoint exists to avoid), so these field
/// names are load-bearing — locked by `the_push_body_matches_the_phones_..._contract`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecallWire<'a> {
    version: u32,
    as_of: u64,
    entities: &'a [ProjectedEntity],
    relations: &'a [ProjectedRelation],
    recent_observations: &'a [ProjectedObservation],
    predictions: &'a [ProjectedPrediction],
    profile: ProfileWire<'a>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileWire<'a> {
    facts: &'a [String],
    preferences: &'a [String],
    /// A plain string on the wire (the route reads `str(p.communicationStyle)`); an
    /// unlearned register is `""`, never null/absent.
    communication_style: &'a str,
    dynamic_context: &'a str,
}

/// Shape a gated [`RecallProjection`] into the route's camelCase §1 body.
fn recall_upload_body(projection: &RecallProjection) -> Result<String, SyncError> {
    let wire = RecallWire {
        version: projection.version,
        as_of: projection.as_of,
        entities: &projection.entities,
        relations: &projection.relations,
        recent_observations: &projection.recent_observations,
        predictions: &projection.predictions,
        profile: ProfileWire {
            facts: &projection.profile.facts,
            preferences: &projection.profile.preferences,
            communication_style: projection
                .profile
                .communication_style
                .as_deref()
                .unwrap_or(""),
            dynamic_context: &projection.profile.dynamic_context,
        },
    };
    Ok(serde_json::to_string(&wire)?)
}

/// Push the recall projection to the **sibling** server-readable store
/// ([`RECALL_PATH`], NOT the lossy profile route) — same `K_server`-at-rest + AAD=
/// `user_id` as the Tier-A profile (ADR-0010 §2). The projection is **gated once
/// more right before it leaves** (defence in depth — nothing reaches the server
/// ungated), then shaped to the route's exact camelCase §1 body. The caller owns the
/// *when* (the sync tick); `as_of` carries the eventually-consistent stamp.
pub fn push_recall(
    transport: &dyn RecallTransport,
    projection: &mut RecallProjection,
    recipient: Recipient,
) -> Result<(), SyncError> {
    gate(projection, recipient);
    transport.upload(&recall_upload_body(projection)?)
}

/// Top entities across all kinds, salience-ranked (salience = how many observations
/// evidence the entity), capped. **Zero-evidence entities are skipped** — after a
/// privacy purge erases the sensitive observations that evidenced an entity (e.g. a
/// bank orphaned when its only evidence was a financial email), that entity has no
/// remaining grounding and must NOT reach the server-readable projection (ADR-0012
/// cleanup 2). An entity with no evidence is also just noise.
fn gather_entities(graph: &Graph, limit: usize) -> Vec<ProjectedEntity> {
    let mut out: Vec<ProjectedEntity> = Vec::new();
    for kind in world::ENTITY_KINDS {
        let Ok(entities) = world::entities_of_kind(graph, kind) else {
            continue;
        };
        for e in entities {
            let salience = world::evidence_for(graph, e.id())
                .map(|v| v.len() as u64)
                .unwrap_or(0);
            if salience == 0 {
                continue;
            }
            out.push(ProjectedEntity {
                id: e.id().clone(),
                kind: kind.to_string(),
                name: e.canonical_name().to_string(),
                salience,
            });
        }
    }
    out.sort_by(|a, b| {
        b.salience
            .cmp(&a.salience)
            .then_with(|| a.name.cmp(&b.name))
    });
    out.truncate(limit);
    out
}

/// Relations strictly AMONG the projected entities (by name) — no edge to an
/// entity that didn't make the cut.
fn gather_relations(
    graph: &Graph,
    entities: &[ProjectedEntity],
    limit: usize,
) -> Vec<ProjectedRelation> {
    let names: HashSet<&str> = entities.iter().map(|e| e.name.as_str()).collect();
    let mut out: Vec<ProjectedRelation> = Vec::new();
    for e in entities {
        for rel in [
            world::relation::WORKS_WITH,
            world::relation::COLLABORATES_ON,
            world::relation::OWNS,
            world::relation::USES,
            world::relation::PART_OF,
        ] {
            let Ok(targets) = world::related(graph, &e.id, rel) else {
                continue;
            };
            for t in targets {
                let dst = t.canonical_name();
                if names.contains(dst) {
                    out.push(ProjectedRelation {
                        src: e.name.clone(),
                        dst: dst.to_string(),
                        kind: rel.to_string(),
                    });
                }
            }
        }
        if out.len() >= limit {
            break;
        }
    }
    out.truncate(limit);
    out
}

/// The recent observations (newest first), capped.
fn gather_recent_observations(graph: &Graph, limit: usize) -> Vec<ProjectedObservation> {
    world::recent_observations(graph, limit)
        .unwrap_or_default()
        .into_iter()
        .map(|o| ProjectedObservation {
            text: o.text().to_string(),
            ts: o.learned_at(),
            kind: "observation".to_string(),
        })
        .collect()
}

/// The established "after X you usually Y" chains, capped.
fn gather_predictions(graph: &Graph, limit: usize) -> Vec<ProjectedPrediction> {
    world::established_chains(graph, limit)
        .unwrap_or_default()
        .into_iter()
        .map(|(after, next, count)| ProjectedPrediction { after, next, count })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_egress_gate_is_fail_closed_and_reuses_the_canonical_screen() {
        // A secret never passes (the canonical floor); a benign name does.
        assert!(!may_project(
            "my password is hunter2",
            Recipient::OwnDevices
        ));
        assert!(!may_project(
            "bank account 12345 routing 9999",
            Recipient::OwnDevices
        ));
        assert!(may_project("Priya", Recipient::OwnDevices));
        assert!(may_project("the atlas project", Recipient::OwnDevices));
        // The floor is the SAME screen Tier-A uses — a regression there is caught
        // here too (one source of truth).
        assert_eq!(
            may_project("api key sk-123", Recipient::OwnDevices),
            !super::profile::looks_sensitive("api key sk-123")
        );
    }

    fn entity(name: &str) -> ProjectedEntity {
        ProjectedEntity {
            id: name.into(),
            kind: "entity_person".into(),
            name: name.into(),
            salience: 1,
        }
    }

    #[test]
    fn a_sensitive_entity_observation_or_prediction_never_enters_the_projection() {
        let mut p = RecallProjection {
            version: PROJECTION_VERSION,
            entities: vec![entity("Priya"), entity("my password vault")],
            relations: vec![
                ProjectedRelation {
                    src: "Priya".into(),
                    dst: "atlas".into(),
                    kind: "collaborates_on".into(),
                },
                // dangling once "my password vault" is gated out:
                ProjectedRelation {
                    src: "my password vault".into(),
                    dst: "atlas".into(),
                    kind: "owns".into(),
                },
            ],
            recent_observations: vec![
                ProjectedObservation {
                    text: "Paired with Priya on atlas".into(),
                    ts: 1,
                    kind: "fact".into(),
                },
                ProjectedObservation {
                    text: "my ssn is 000-00-0000".into(),
                    ts: 2,
                    kind: "fact".into(),
                },
            ],
            predictions: vec![ProjectedPrediction {
                after: "open the password manager".into(),
                next: "type my password".into(),
                count: 3,
            }],
            ..Default::default()
        };

        gate(&mut p, Recipient::OwnDevices);

        // The sensitive entity is gone, and so is the relation that referenced it.
        assert!(p.entities.iter().all(|e| e.name == "Priya"));
        assert!(
            p.relations
                .iter()
                .all(|r| r.src == "Priya" || r.dst == "Priya"),
            "no relation references a gated (possibly sensitive) entity"
        );
        // The sensitive observation + the password prediction are gone.
        assert!(
            p.recent_observations
                .iter()
                .all(|o| o.text.contains("Priya"))
        );
        assert!(p.predictions.is_empty());
        // Belt-and-braces: the sensitive text appears NOWHERE in the projection.
        let blob = serde_json::to_string(&p).unwrap().to_lowercase();
        for needle in ["password", "ssn", "000-00-0000", "vault"] {
            assert!(
                !blob.contains(needle),
                "leaked {needle:?} into the projection"
            );
        }
    }

    #[test]
    fn project_from_graph_gathers_the_users_world_and_gates_it() {
        use eri_graph::{Graph, world};
        let g = Graph::open_in_memory().unwrap();
        let priya = world::record_entity(&g, world::entity_kind::PERSON, "Priya").unwrap();
        let atlas = world::record_entity(&g, world::entity_kind::PROJECT, "atlas").unwrap();
        world::relate(&g, &priya, &atlas, world::relation::COLLABORATES_ON).unwrap();
        // A sensitive entity that must NOT cross the boundary:
        world::record_entity(&g, world::entity_kind::PROJECT, "my bank account 999").unwrap();
        // Evidence so the entities are grounded (0-evidence entities are skipped) — the
        // bank one too, so it's dropped by the GATE (its name), not for lack of evidence.
        let obs = world::record_observation(&g, "Paired with Priya on atlas").unwrap();
        world::link_evidence(&g, &obs, world::entity_kind::PERSON, "Priya").unwrap();
        world::link_evidence(&g, &obs, world::entity_kind::PROJECT, "atlas").unwrap();
        world::link_evidence(&g, &obs, world::entity_kind::PROJECT, "my bank account 999").unwrap();
        world::link_next(&g, "open editor", "run tests").unwrap();
        world::link_next(&g, "open editor", "run tests").unwrap();

        let p = project_from_graph(&g, Recipient::OwnDevices, 123, &Limits::default());

        assert!(p.entities.iter().any(|e| e.name == "Priya"));
        assert!(p.entities.iter().any(|e| e.name == "atlas"));
        assert!(
            p.relations
                .iter()
                .any(|r| r.src == "Priya" && r.dst == "atlas")
        );
        assert!(
            p.recent_observations
                .iter()
                .any(|o| o.text.contains("Priya"))
        );
        assert!(
            p.predictions
                .iter()
                .any(|pr| pr.after == "open editor" && pr.next == "run tests" && pr.count == 2)
        );
        // The sensitive entity is gated out — the gather path still gates.
        assert!(!p.entities.iter().any(|e| e.name.contains("bank account")));
        assert_eq!((p.as_of, p.version), (123, PROJECTION_VERSION));
    }

    #[test]
    fn a_zero_evidence_entity_is_excluded_from_the_projection() {
        // Cleanup 2 (ADR-0012): after a purge erases the sensitive observations that
        // evidenced a bank entity, that entity is orphaned (0 evidence) and must NOT
        // reach the server-readable projection.
        use eri_graph::{Graph, world};
        let g = Graph::open_in_memory().unwrap();
        let obs = world::record_observation(&g, "Paired with Priya").unwrap();
        world::link_evidence(&g, &obs, world::entity_kind::PERSON, "Priya").unwrap();
        world::record_entity(&g, world::entity_kind::PERSON, "RBC").unwrap(); // orphaned

        let p = project_from_graph(&g, Recipient::OwnDevices, 0, &Limits::default());
        assert!(
            p.entities.iter().any(|e| e.name == "Priya"),
            "an evidenced entity is projected"
        );
        assert!(
            !p.entities.iter().any(|e| e.name == "RBC"),
            "a 0-evidence (purge-orphaned) entity is excluded from Tier-A"
        );
    }

    #[test]
    fn a_projection_for_one_user_contains_nothing_from_another() {
        // Per-user isolation (ADR-0010 §6): project_from_graph reads ONLY the graph
        // it's handed, so user A's projection holds none of user B's world — and
        // the facade opens only `user_id`'s graph. No cross-principal leak.
        use eri_graph::{Graph, world};
        let a = Graph::open_in_memory().unwrap();
        let oa = world::record_observation(&a, "Priya on atlas").unwrap();
        world::link_evidence(&a, &oa, world::entity_kind::PERSON, "Priya").unwrap();
        world::link_evidence(&a, &oa, world::entity_kind::PROJECT, "atlas").unwrap();
        let b = Graph::open_in_memory().unwrap();
        let ob = world::record_observation(&b, "Bob on zephyr").unwrap();
        world::link_evidence(&b, &ob, world::entity_kind::PERSON, "Bob").unwrap();
        world::link_evidence(&b, &ob, world::entity_kind::PROJECT, "zephyr").unwrap();

        let pa = serde_json::to_string(&project_from_graph(
            &a,
            Recipient::OwnDevices,
            0,
            &Limits::default(),
        ))
        .unwrap();
        let pb = serde_json::to_string(&project_from_graph(
            &b,
            Recipient::OwnDevices,
            0,
            &Limits::default(),
        ))
        .unwrap();

        assert!(pa.contains("Priya") && pa.contains("atlas"));
        assert!(
            !pa.contains("Bob") && !pa.contains("zephyr"),
            "user A's projection leaked user B's world"
        );
        assert!(pb.contains("Bob") && pb.contains("zephyr"));
        assert!(
            !pb.contains("Priya") && !pb.contains("atlas"),
            "user B's projection leaked user A's world"
        );
    }

    #[test]
    fn push_recall_gates_the_projection_before_it_leaves() {
        // Defence in depth (ADR-0010): push_recall gates the fully-composed
        // projection right before the transport sees it — a sensitive item that
        // somehow reached the projection never crosses the boundary. Rides the
        // existing ProfileTransport (the server K_server-encrypts it, AAD=user_id).
        use std::cell::RefCell;
        struct Capture(RefCell<String>);
        impl RecallTransport for Capture {
            fn upload(&self, body: &str) -> Result<(), SyncError> {
                *self.0.borrow_mut() = body.to_string();
                Ok(())
            }
        }

        let mut p = RecallProjection {
            entities: vec![entity("Priya")],
            recent_observations: vec![ProjectedObservation {
                text: "my ssn is 000-00-0000".into(),
                ts: 0,
                kind: "fact".into(),
            }],
            ..Default::default()
        };
        let t = Capture(RefCell::new(String::new()));
        push_recall(&t, &mut p, Recipient::OwnDevices).unwrap();

        let body = t.0.borrow().to_lowercase();
        assert!(body.contains("priya"), "benign content is pushed");
        assert!(
            !body.contains("ssn") && !body.contains("000-00-0000"),
            "sensitive content is gated out BEFORE it reaches the transport"
        );
    }

    #[test]
    fn the_push_body_matches_the_phones_camelcase_wire_contract() {
        // The sibling route (`coerceRecallProjection`) reads camelCase keys; a
        // snake_case key is silently coerced to empty on the phone — the exact
        // silent-drop the sibling endpoint exists to avoid. Lock the wire field
        // names to the contract so an internal struct rename can't regress it.
        use std::cell::RefCell;
        struct Capture(RefCell<String>);
        impl RecallTransport for Capture {
            fn upload(&self, body: &str) -> Result<(), SyncError> {
                *self.0.borrow_mut() = body.to_string();
                Ok(())
            }
        }

        let mut p = RecallProjection {
            version: PROJECTION_VERSION,
            as_of: 1_750_000_000_000,
            recent_observations: vec![ProjectedObservation {
                text: "paired with Priya on atlas".into(),
                ts: 1,
                kind: "fact".into(),
            }],
            predictions: vec![ProjectedPrediction {
                after: "open editor".into(),
                next: "run tests".into(),
                count: 4,
            }],
            profile: Profile {
                facts: vec!["builds eri".into()],
                preferences: vec![],
                dynamic_context: "today: shipped the recall push".into(),
                communication_style: Some("lowercase, terse".into()),
            },
            ..Default::default()
        };
        let t = Capture(RefCell::new(String::new()));
        push_recall(&t, &mut p, Recipient::OwnDevices).unwrap();
        let v: serde_json::Value = serde_json::from_str(&t.0.borrow()).unwrap();

        // camelCase keys the route reads — present + correct.
        assert_eq!(v["asOf"], 1_750_000_000_000_u64);
        assert_eq!(
            v["recentObservations"][0]["text"],
            "paired with Priya on atlas"
        );
        assert_eq!(v["predictions"][0]["after"], "open editor");
        assert_eq!(v["profile"]["communicationStyle"], "lowercase, terse");
        assert_eq!(
            v["profile"]["dynamicContext"],
            "today: shipped the recall push"
        );
        // snake_case keys the route would IGNORE — must be absent.
        assert!(
            v["as_of"].is_null(),
            "snake_case as_of must not be on the wire"
        );
        assert!(v["recent_observations"].is_null());
        assert!(v["profile"]["communication_style"].is_null());
        assert!(v["profile"]["dynamic_context"].is_null());
    }

    #[test]
    fn benign_content_survives_the_gate_unchanged() {
        let mut p = RecallProjection {
            entities: vec![entity("Priya")],
            relations: vec![ProjectedRelation {
                src: "Priya".into(),
                dst: "Priya".into(),
                kind: "works_with".into(),
            }],
            recent_observations: vec![ProjectedObservation {
                text: "shipped atlas".into(),
                ts: 1,
                kind: "fact".into(),
            }],
            predictions: vec![ProjectedPrediction {
                after: "open editor".into(),
                next: "run tests".into(),
                count: 4,
            }],
            ..Default::default()
        };
        let before = p.clone();
        gate(&mut p, Recipient::OwnDevices);
        assert_eq!(p, before, "the gate drops nothing benign");
    }
}
