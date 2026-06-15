//! Fuse the three on-device extractor streams into one clean element list.
//!
//! The capture sidecar emits three separate lists per frame — AX, OCR, and
//! Vision — that frequently describe the *same* on-screen thing from different
//! angles (AX knows a button is a button and exactly where it is; OCR can read
//! the glyphs on it; the ML detector spots it when AX is blind). [`fuse`]
//! collapses them into a single de-duplicated list with:
//!
//! * **geometry/role precedence** `Ax > Ocr > Vision` — AX bboxes are exact, so
//!   the AX box + role wins a merge;
//! * **label/text fill** — whichever source has a non-empty `label` / `text`
//!   donates it to the merged element when the winner lacks one (OCR reads
//!   labels AX can't, etc.);
//! * **stable, unique ids** — `el-0`, `el-1`, … assigned in deterministic
//!   order so the same frame always fuses to the same ids (Claude can refer to
//!   a mark across turns).
//!
//! Pure + deterministic: no clock, no RNG, no I/O. Unit-tested without a screen.

use super::element::ScreenElement;

/// Two elements whose bboxes overlap by more than this IoU are treated as the
/// same on-screen element and merged. Chosen empirically: AX and OCR boxes for
/// one control overlap heavily, while adjacent distinct controls do not.
pub const DEFAULT_IOU_THRESHOLD: f64 = 0.6;

/// Merge the AX, OCR, and Vision element lists into one fused, de-duplicated,
/// stably-id'd list. See the module docs for precedence + fill rules.
///
/// Order of the output is deterministic: clusters are formed in the order
/// elements are first seen (AX, then OCR, then Vision), and each cluster keeps
/// the position of its first-seen member.
pub fn fuse(
    ax: Vec<ScreenElement>,
    ocr: Vec<ScreenElement>,
    vision: Vec<ScreenElement>,
) -> Vec<ScreenElement> {
    fuse_with_threshold(ax, ocr, vision, DEFAULT_IOU_THRESHOLD)
}

/// [`fuse`] with an explicit IoU threshold — exposed for tests.
pub fn fuse_with_threshold(
    ax: Vec<ScreenElement>,
    ocr: Vec<ScreenElement>,
    vision: Vec<ScreenElement>,
    iou_threshold: f64,
) -> Vec<ScreenElement> {
    // Concatenate in precedence order so a cluster's first-seen member is the
    // highest-precedence source available, and so iteration order is stable.
    let mut incoming = Vec::with_capacity(ax.len() + ocr.len() + vision.len());
    incoming.extend(ax);
    incoming.extend(ocr);
    incoming.extend(vision);

    // Each cluster is the list of elements judged to be the same on-screen
    // thing. We grow clusters greedily: an incoming element joins the first
    // existing cluster it overlaps, else starts its own.
    let mut clusters: Vec<Vec<ScreenElement>> = Vec::new();
    for el in incoming {
        match clusters
            .iter_mut()
            .find(|cluster| cluster.iter().any(|m| m.overlaps(&el, iou_threshold)))
        {
            Some(cluster) => cluster.push(el),
            None => clusters.push(vec![el]),
        }
    }

    clusters
        .into_iter()
        .enumerate()
        .map(|(idx, cluster)| merge_cluster(idx, cluster))
        .collect()
}

/// Collapse one cluster of overlapping elements into a single merged element
/// with a freshly-assigned id.
fn merge_cluster(idx: usize, cluster: Vec<ScreenElement>) -> ScreenElement {
    // The geometry/role winner: lowest precedence tuple (AX first, larger box
    // breaks ties). `min_by` keeps the first on equal keys, which is stable.
    let winner = cluster
        .iter()
        .min_by(|a, b| {
            a.precedence()
                .partial_cmp(&b.precedence())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .expect("cluster is never empty");

    // Start from the winner's geometry + role, then fill label/text/interactable
    // from the cluster where the winner is missing them.
    let label = first_non_empty(cluster.iter().map(|e| e.label.as_str()))
        .unwrap_or_default()
        .to_string();
    let text = cluster.iter().find_map(|e| {
        e.text
            .as_deref()
            .filter(|t| !t.trim().is_empty())
            .map(str::to_string)
    });
    // Interactable if ANY source says so — a missed `false` from OCR shouldn't
    // demote a control AX flagged interactable.
    let interactable = cluster.iter().any(|e| e.interactable);

    ScreenElement {
        id: format!("el-{idx}"),
        role: winner.role.clone(),
        label,
        bbox: winner.bbox,
        interactable,
        text,
        source: winner.source,
    }
}

/// First non-empty (after trim) string in an iterator, preserving order so the
/// highest-precedence label wins (AX list comes first).
fn first_non_empty<'a>(mut it: impl Iterator<Item = &'a str>) -> Option<&'a str> {
    it.find(|s| !s.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::screen_extract::element::{BBox, ElementSource, ScreenElement};

    fn el(
        role: &str,
        label: &str,
        bbox: BBox,
        interactable: bool,
        text: Option<&str>,
        source: ElementSource,
    ) -> ScreenElement {
        ScreenElement {
            id: String::new(),
            role: role.into(),
            label: label.into(),
            bbox,
            interactable,
            text: text.map(str::to_string),
            source,
        }
    }

    #[test]
    fn fuse_dedups_overlapping_ax_and_ocr_into_one() {
        // AX knows the button + its box but has no readable label; OCR reads
        // "Submit" over the same box. They must collapse to ONE element.
        let ax = vec![el(
            "button",
            "",
            BBox::new(0.10, 0.10, 0.20, 0.06),
            true,
            None,
            ElementSource::Ax,
        )];
        let ocr = vec![el(
            "text",
            "Submit",
            BBox::new(0.11, 0.10, 0.18, 0.06),
            false,
            Some("Submit"),
            ElementSource::Ocr,
        )];

        let fused = fuse(ax, ocr, vec![]);
        assert_eq!(fused.len(), 1, "overlapping AX+OCR must dedupe to one");
        let m = &fused[0];
        // AX geometry/role wins.
        assert_eq!(m.role, "button");
        assert_eq!(m.source, ElementSource::Ax);
        // OCR fills the label AX lacked.
        assert_eq!(m.label, "Submit");
        assert_eq!(m.text.as_deref(), Some("Submit"));
        // Interactable preserved from AX.
        assert!(m.interactable);
    }

    #[test]
    fn fuse_keeps_disjoint_elements_separate() {
        let ax = vec![
            el(
                "button",
                "A",
                BBox::new(0.0, 0.0, 0.1, 0.1),
                true,
                None,
                ElementSource::Ax,
            ),
            el(
                "button",
                "B",
                BBox::new(0.5, 0.5, 0.1, 0.1),
                true,
                None,
                ElementSource::Ax,
            ),
        ];
        let fused = fuse(ax, vec![], vec![]);
        assert_eq!(fused.len(), 2);
    }

    #[test]
    fn fuse_assigns_unique_stable_ids() {
        let ax = vec![
            el(
                "button",
                "A",
                BBox::new(0.0, 0.0, 0.1, 0.1),
                true,
                None,
                ElementSource::Ax,
            ),
            el(
                "button",
                "B",
                BBox::new(0.5, 0.5, 0.1, 0.1),
                true,
                None,
                ElementSource::Ax,
            ),
        ];
        let fused = fuse(ax.clone(), vec![], vec![]);
        let ids: Vec<&str> = fused.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["el-0", "el-1"]);

        // Stable: same input → same ids.
        let again = fuse(ax, vec![], vec![]);
        assert_eq!(
            again.iter().map(|e| e.id.clone()).collect::<Vec<_>>(),
            vec!["el-0".to_string(), "el-1".to_string()]
        );
        // Unique.
        let mut sorted = ids.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), ids.len());
    }

    #[test]
    fn fuse_ax_geometry_wins_over_vision() {
        // Vision sees a slightly-off box; AX has the exact one. The two
        // overlap above threshold (same on-screen control), so they merge and
        // the AX bbox must survive as the geometry winner.
        let ax_box = BBox::new(0.20, 0.20, 0.10, 0.05);
        let ax = vec![el("link", "Docs", ax_box, true, None, ElementSource::Ax)];
        let vision = vec![el(
            "clickable",
            "",
            BBox::new(0.205, 0.202, 0.10, 0.05),
            true,
            None,
            ElementSource::Vision,
        )];
        let fused = fuse(ax, vec![], vision);
        assert_eq!(fused.len(), 1);
        assert_eq!(fused[0].bbox, ax_box);
        assert_eq!(fused[0].role, "link");
        assert_eq!(fused[0].source, ElementSource::Ax);
    }

    #[test]
    fn fuse_vision_fills_when_ax_blind() {
        // No AX at all (Electron app); Vision is the only source.
        let vision = vec![el(
            "clickable",
            "Buy now",
            BBox::new(0.3, 0.3, 0.2, 0.08),
            true,
            None,
            ElementSource::Vision,
        )];
        let fused = fuse(vec![], vec![], vision);
        assert_eq!(fused.len(), 1);
        assert_eq!(fused[0].source, ElementSource::Vision);
        assert_eq!(fused[0].label, "Buy now");
    }

    #[test]
    fn fuse_empty_inputs_yield_empty() {
        assert!(fuse(vec![], vec![], vec![]).is_empty());
    }

    #[test]
    fn fuse_merges_interactable_from_any_source() {
        // OCR (non-interactable text) overlaps an AX interactable control.
        let ax = vec![el(
            "checkbox",
            "",
            BBox::new(0.1, 0.1, 0.05, 0.05),
            true,
            None,
            ElementSource::Ax,
        )];
        let ocr = vec![el(
            "text",
            "Agree",
            BBox::new(0.1, 0.1, 0.05, 0.05),
            false,
            Some("Agree"),
            ElementSource::Ocr,
        )];
        let fused = fuse(ax, ocr, vec![]);
        assert_eq!(fused.len(), 1);
        assert!(fused[0].interactable);
    }
}
