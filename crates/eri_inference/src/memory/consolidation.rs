//! Episodic→semantic consolidation (mem0 / supermemory pattern).
//!
//! Raw episodic observations (a diff accepted here, a voice cue there) pile up
//! fast and, injected one-by-one, drown the prompt in noise. Consolidation
//! distills clusters of near-identical episodes into a single durable
//! **semantic** fact — "Frequently accepts edits in `src/components` (5×)" — so
//! recall and the Tier-A profile carry the *pattern*, not the log. The episodes
//! are kept (history + sync) but hidden from recall, mirroring `superseded`.
//!
//! Everything here is pure + zero-token: clustering is greedy single-link over
//! the existing hash-embeddings, summaries are derived from the episodes' own
//! bodies. No model round-trip — consolidation runs on the CPU during sync.

use super::{Observation, TOMBSTONE_KIND, Visibility, embeddings};

/// Kind marker for a consolidated rollup — a durable fact derived from a cluster
/// of episodic observations. Workspace-scoped (carries the cluster's
/// `workspace_hash`), so it behaves like a learned preference, not a global
/// `fact`.
pub(crate) const SEMANTIC_KIND: &str = "semantic";

/// Minimum episodes in a cluster before it's worth rolling up. Below this a
/// "pattern" is just coincidence — keep the raw episodes.
const MIN_CLUSTER_SIZE: usize = 3;

/// Cosine above which two episodes are treated as the same recurring behaviour.
/// High enough that unrelated activity stays in separate clusters.
const CLUSTER_THRESHOLD: f32 = 0.78;

/// The churny, low-signal kinds that are worth distilling. Durable kinds
/// (`fact`, `preference`, `habit`, `semantic`) are already condensed; tombstones
/// and control/turn records are structural, not behavioural.
pub(crate) fn is_episodic(kind: &str) -> bool {
    matches!(kind, "edit_accepted" | "edit_rejected" | "voice_pattern")
}

/// A semantic fact to be created from a consolidated cluster. The store assigns
/// the id + embedding; this carries only what the pure pass can derive.
pub(crate) struct SemanticDraft {
    pub workspace_hash: String,
    /// Newest episode's timestamp — the rollup is "as of" the latest signal.
    pub ts_ms: u64,
    pub body: String,
}

/// The outcome of a consolidation pass over an observation slice: which indices
/// to mark `consolidated`, and the semantic facts to append. Pure — the store
/// applies it (assigns ids, embeds, supersedes older rollups, saves).
pub(crate) struct ConsolidationPlan {
    pub consume: Vec<usize>,
    pub new_facts: Vec<SemanticDraft>,
}

/// Plan a consolidation pass: cluster the un-consolidated episodic observations
/// (grouped by workspace + kind, so accepts and rejects never merge) and roll up
/// every cluster of at least [`MIN_CLUSTER_SIZE`] near-identical episodes.
pub(crate) fn plan_consolidation(obs: &[Observation]) -> ConsolidationPlan {
    use std::collections::BTreeMap;

    // Group candidate indices by (workspace_hash, kind). BTreeMap keeps the pass
    // deterministic regardless of store order — important for stable tests + sync.
    let mut groups: BTreeMap<(&str, &str), Vec<usize>> = BTreeMap::new();
    for (i, o) in obs.iter().enumerate() {
        if is_episodic(&o.kind)
            && matches!(o.visibility, Visibility::Active)
            && o.kind != TOMBSTONE_KIND
            && !o.embedding.is_empty()
        {
            groups
                .entry((o.workspace_hash.as_str(), o.kind.as_str()))
                .or_default()
                .push(i);
        }
    }

    let mut plan = ConsolidationPlan {
        consume: Vec::new(),
        new_facts: Vec::new(),
    };
    for ((workspace_hash, kind), indices) in groups {
        for cluster in cluster_indices(&indices, obs) {
            if cluster.len() < MIN_CLUSTER_SIZE {
                continue;
            }
            let ts_ms = cluster.iter().map(|&i| obs[i].ts_ms).max().unwrap_or(0);
            let body = summarize_cluster(kind, &cluster, obs);
            plan.consume.extend(cluster);
            plan.new_facts.push(SemanticDraft {
                workspace_hash: workspace_hash.to_string(),
                ts_ms,
                body,
            });
        }
    }
    plan
}

/// Greedy single-link clustering by embedding cosine. Groups are small (one
/// kind, one workspace), so O(n²) is fine. An index joins the first cluster it's
/// similar to *any* member of; otherwise it seeds a new cluster.
fn cluster_indices(indices: &[usize], obs: &[Observation]) -> Vec<Vec<usize>> {
    let mut clusters: Vec<Vec<usize>> = Vec::new();
    'next: for &i in indices {
        for cluster in clusters.iter_mut() {
            let joins = cluster.iter().any(|&j| {
                embeddings::cosine(&obs[i].embedding, &obs[j].embedding) > CLUSTER_THRESHOLD
            });
            if joins {
                cluster.push(i);
                continue 'next;
            }
        }
        clusters.push(vec![i]);
    }
    clusters
}

/// Derive a readable one-line summary for a cluster. Edit outcomes get a
/// directory rollup parsed from their JSON `path`; everything else falls back to
/// the cluster medoid (its most central episode) plus an occurrence count.
fn summarize_cluster(kind: &str, cluster: &[usize], obs: &[Observation]) -> String {
    let n = cluster.len();
    match kind {
        "edit_accepted" | "edit_rejected" => {
            let verb = if kind == "edit_accepted" {
                "accepts"
            } else {
                "rejects"
            };
            let dir = modal_edit_dir(cluster, obs);
            format!("Frequently {verb} edits in {dir} ({n}×)")
        }
        _ => {
            let medoid = medoid_index(cluster, obs);
            let snippet = truncate(obs[medoid].body.trim().lines().next().unwrap_or(""), 100);
            format!("{snippet} (recurring, {n}×)")
        }
    }
}

/// The most common parent directory across a cluster's edit paths. Edit bodies
/// are JSON `{path, summary}`; an unparseable or path-less body contributes
/// nothing. Falls back to "various files" when no directory can be derived.
fn modal_edit_dir(cluster: &[usize], obs: &[Observation]) -> String {
    use std::collections::HashMap;
    let mut counts: HashMap<String, usize> = HashMap::new();
    for &i in cluster {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&obs[i].body)
            && let Some(path) = v.get("path").and_then(|p| p.as_str())
        {
            let dir = match path.rsplit_once('/') {
                Some((parent, _)) if !parent.is_empty() => parent.to_string(),
                _ => "the project root".to_string(),
            };
            *counts.entry(dir).or_default() += 1;
        }
    }
    counts
        .into_iter()
        // Most frequent wins; ties break alphabetically for determinism.
        .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
        .map(|(dir, _)| format!("`{dir}`"))
        .unwrap_or_else(|| "various files".to_string())
}

/// Index of the cluster medoid: the episode with the greatest total similarity
/// to the others — the most representative single observation.
fn medoid_index(cluster: &[usize], obs: &[Observation]) -> usize {
    *cluster
        .iter()
        .max_by(|&&a, &&b| {
            sim_sum(a, cluster, obs)
                .partial_cmp(&sim_sum(b, cluster, obs))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .unwrap_or(&cluster[0])
}

fn sim_sum(i: usize, cluster: &[usize], obs: &[Observation]) -> f32 {
    cluster
        .iter()
        .filter(|&&j| j != i)
        .map(|&j| embeddings::cosine(&obs[i].embedding, &obs[j].embedding))
        .sum()
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max.saturating_sub(1)).collect();
    format!("{}…", head.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ep(kind: &str, ts: u64, ws: &str, body: &str) -> Observation {
        Observation {
            id: format!("{kind}-{ts}"),
            ts_ms: ts,
            kind: kind.to_string(),
            workspace_hash: ws.to_string(),
            body: body.to_string(),
            embedding: embeddings::embed_text(body),
            valid_from: None,
            visibility: Visibility::Active,
            ..Default::default()
        }
    }

    #[test]
    fn is_episodic_classifies_churn_not_durable_kinds() {
        assert!(is_episodic("edit_accepted"));
        assert!(is_episodic("voice_pattern"));
        assert!(!is_episodic("fact"));
        assert!(!is_episodic(SEMANTIC_KIND));
        assert!(!is_episodic(TOMBSTONE_KIND));
    }

    #[test]
    fn clusters_of_three_similar_edits_become_one_semantic_fact() {
        let obs = vec![
            ep(
                "edit_accepted",
                1,
                "w",
                r#"{"path":"src/components/Header.tsx","summary":"adjust layout"}"#,
            ),
            ep(
                "edit_accepted",
                2,
                "w",
                r#"{"path":"src/components/Footer.tsx","summary":"adjust layout"}"#,
            ),
            ep(
                "edit_accepted",
                3,
                "w",
                r#"{"path":"src/components/Nav.tsx","summary":"adjust layout"}"#,
            ),
        ];
        let plan = plan_consolidation(&obs);
        assert_eq!(plan.new_facts.len(), 1, "one cluster → one rollup");
        assert_eq!(plan.consume.len(), 3, "all three episodes consumed");
        let body = &plan.new_facts[0].body;
        assert!(body.contains("accepts"), "verb from kind: {body}");
        assert!(body.contains("src/components"), "modal dir: {body}");
        assert!(body.contains("3×"), "occurrence count: {body}");
        assert_eq!(
            plan.new_facts[0].ts_ms, 3,
            "rollup is as-of the newest episode"
        );
    }

    #[test]
    fn fewer_than_three_episodes_are_not_consolidated() {
        let obs = vec![
            ep(
                "edit_accepted",
                1,
                "w",
                r#"{"path":"src/a.tsx","summary":"x"}"#,
            ),
            ep(
                "edit_accepted",
                2,
                "w",
                r#"{"path":"src/b.tsx","summary":"x"}"#,
            ),
        ];
        let plan = plan_consolidation(&obs);
        assert!(
            plan.new_facts.is_empty(),
            "two episodes is coincidence, not a pattern"
        );
    }

    #[test]
    fn accepts_and_rejects_never_merge_into_one_cluster() {
        // Same workspace + similar text, but opposite signals — they must stay
        // in separate kind-groups so the rollup verb is never ambiguous.
        let obs = vec![
            ep(
                "edit_accepted",
                1,
                "w",
                r#"{"path":"src/a.tsx","summary":"layout tweak"}"#,
            ),
            ep(
                "edit_accepted",
                2,
                "w",
                r#"{"path":"src/b.tsx","summary":"layout tweak"}"#,
            ),
            ep(
                "edit_accepted",
                3,
                "w",
                r#"{"path":"src/c.tsx","summary":"layout tweak"}"#,
            ),
            ep(
                "edit_rejected",
                4,
                "w",
                r#"{"path":"src/d.tsx","summary":"layout tweak"}"#,
            ),
            ep(
                "edit_rejected",
                5,
                "w",
                r#"{"path":"src/e.tsx","summary":"layout tweak"}"#,
            ),
            ep(
                "edit_rejected",
                6,
                "w",
                r#"{"path":"src/f.tsx","summary":"layout tweak"}"#,
            ),
        ];
        let plan = plan_consolidation(&obs);
        assert_eq!(
            plan.new_facts.len(),
            2,
            "one accept rollup + one reject rollup"
        );
        assert!(plan.new_facts.iter().any(|f| f.body.contains("accepts")));
        assert!(plan.new_facts.iter().any(|f| f.body.contains("rejects")));
    }

    #[test]
    fn already_consolidated_episodes_are_skipped() {
        let mut obs = vec![
            ep(
                "edit_accepted",
                1,
                "w",
                r#"{"path":"src/a.tsx","summary":"x"}"#,
            ),
            ep(
                "edit_accepted",
                2,
                "w",
                r#"{"path":"src/b.tsx","summary":"x"}"#,
            ),
            ep(
                "edit_accepted",
                3,
                "w",
                r#"{"path":"src/c.tsx","summary":"x"}"#,
            ),
        ];
        for o in &mut obs {
            o.visibility = Visibility::Consolidated;
        }
        let plan = plan_consolidation(&obs);
        assert!(
            plan.new_facts.is_empty(),
            "consolidated episodes never re-roll"
        );
    }

    #[test]
    fn voice_patterns_fall_back_to_medoid_summary() {
        let obs = vec![
            ep(
                "voice_pattern",
                1,
                "w",
                "speaks in short bursts then pauses",
            ),
            ep(
                "voice_pattern",
                2,
                "w",
                "speaks in short bursts then pauses",
            ),
            ep("voice_pattern", 3, "w", "speaks in short bursts and pauses"),
        ];
        let plan = plan_consolidation(&obs);
        assert_eq!(plan.new_facts.len(), 1);
        let body = &plan.new_facts[0].body;
        assert!(
            body.contains("short bursts"),
            "medoid body surfaced: {body}"
        );
        assert!(body.contains("recurring, 3×"), "count appended: {body}");
    }
}
