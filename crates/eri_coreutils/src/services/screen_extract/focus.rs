//! Gaze-to-element focus resolution — eri's "knows where you're looking".
//!
//! The gaze pipeline ([`crate::services::gaze`]) yields a smoothed, calibrated
//! gaze POINT (`x, y` normalised in `[0,1]`); the screen extractor
//! ([`super`]) yields the fused, marked [`ScreenElement`] list (each with a
//! normalised [`super::BBox`]). This module FUSES the two: given where the eye
//! is pointing + what's on screen, it resolves WHAT the user is looking at.
//!
//! That's the perception primitive a hands-free deictic command needs: "do
//! that", "click there", "what's this" all resolve against the focused element
//! and its neighbours, so the control loop can act on intent without the user
//! naming a target.
//!
//! ## Coordinate space
//!
//! Both the gaze point and every bbox are normalised `[0,1]` over the same
//! captured frame (see `gaze.rs` and `element.rs`), so all geometry here is in
//! those same units — [`FOCUS_RADIUS_PX`] is a *fraction of the frame*, not raw
//! pixels (the name keeps the perceptual intent; the value is normalised).
//!
//! Pure geometry: point-in-rect + centre distance. No clock, no I/O, no RNG —
//! unit-tested without a live screen or camera. Reuses [`super::BBox`]'s real
//! fields (`x, y, w, h`) and [`super::BBox::center`]; invents nothing.

use super::element::ScreenElement;
use crate::services::gaze::GazePoint;

/// How far outside an element's bounds a gaze point may fall and still be
/// attributed to it, in normalised frame units (so `0.04` ≈ 4% of the frame
/// width/height). Calibrated gaze drifts a few percent off true target; this
/// radius forgives that drift so a glance *near* a small control still resolves
/// to it, while a point in genuine empty space resolves to nothing.
pub const FOCUS_RADIUS_PX: f64 = 0.04;

/// The resolved answer to "what is the user looking at": the focused element
/// (if any), plus the nearest neighbours ranked by distance so a deictic
/// command can disambiguate against the local cluster.
///
/// `focused` is `None` when the gaze lands in empty space (no element contains
/// it and none is within [`FOCUS_RADIUS_PX`]). `neighbors` are the next-nearest
/// elements after the focused one, nearest first; they're always populated when
/// other elements exist, even if `focused` is `None`, so "click there" can fall
/// back to the closest thing the eye was near.
#[derive(Debug, Clone, PartialEq)]
pub struct FocusContext<'a> {
    /// The element the gaze resolves to, if any.
    pub focused: Option<&'a ScreenElement>,
    /// Up to `n` nearest other elements, ranked nearest-first by centre
    /// distance, excluding `focused`.
    pub neighbors: Vec<&'a ScreenElement>,
}

/// Euclidean distance from a gaze point to a bbox centre, in normalised units.
/// Used to *rank* candidates (nearest control under/near the eye).
fn distance_to_center(gaze: GazePoint, el: &ScreenElement) -> f64 {
    let (cx, cy) = el.bbox.center();
    let dx = gaze.x - cx;
    let dy = gaze.y - cy;
    (dx * dx + dy * dy).sqrt()
}

/// Euclidean distance from a gaze point to the *nearest point on* a bbox, in
/// normalised units — `0.0` when the point is inside. This is what
/// [`FOCUS_RADIUS_PX`] is measured against, so "just outside the edge" resolves
/// regardless of how far the element's centre is (a large panel's centre can be
/// far from an edge the eye is grazing).
fn distance_to_bounds(gaze: GazePoint, el: &ScreenElement) -> f64 {
    let b = &el.bbox;
    // Clamp the gaze point onto the rect, then measure the gap to the clamp.
    let nx = gaze.x.clamp(b.x, b.x + b.w);
    let ny = gaze.y.clamp(b.y, b.y + b.h);
    let dx = gaze.x - nx;
    let dy = gaze.y - ny;
    (dx * dx + dy * dy).sqrt()
}

/// True when the gaze point lies inside the element's bounds (inclusive edges).
fn contains(gaze: GazePoint, el: &ScreenElement) -> bool {
    let b = &el.bbox;
    gaze.x >= b.x && gaze.x <= b.x + b.w && gaze.y >= b.y && gaze.y <= b.y + b.h
}

/// Tiebreak key for containers: nearer centre first, then *smaller* area, so a
/// tight control nested in a big panel wins over the panel when the gaze sits
/// in both. Returns a total ordering, NaN-safe.
fn container_rank(gaze: GazePoint, el: &ScreenElement) -> impl PartialOrd {
    (distance_to_center(gaze, el), el.bbox.area())
}

/// Total comparison of two distances, treating `NaN` as greater-than so a
/// degenerate value never wins a `min`/sort and never panics.
fn cmp_dist(a: f64, b: f64) -> std::cmp::Ordering {
    a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Greater)
}

/// Resolve the element the user is looking at.
///
/// 1. If a gaze point lies inside one or more elements' bounds, the nearest by
///    centre distance wins (so a glance into an overlapping container resolves
///    to the tightest control under the eye).
/// 2. Otherwise the nearest element whose centre is within [`FOCUS_RADIUS_PX`]
///    of the gaze point wins (forgiving calibration drift).
/// 3. Otherwise `None` — the gaze is in genuine empty space.
pub fn focused_element(gaze: GazePoint, elements: &[ScreenElement]) -> Option<&ScreenElement> {
    // Prefer a containing element; among containers, the nearest centre wins,
    // ties broken by the smaller (tighter) box.
    let containing = elements
        .iter()
        .filter(|el| contains(gaze, el))
        .min_by(|a, b| {
            container_rank(gaze, a)
                .partial_cmp(&container_rank(gaze, b))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    if containing.is_some() {
        return containing;
    }

    // No container: fall back to the element whose *bounds* are within the
    // radius, nearest-by-bounds first (so a glance just past an edge resolves
    // even when the element's centre is far away).
    elements
        .iter()
        .map(|el| (el, distance_to_bounds(gaze, el)))
        .filter(|(_, d)| *d <= FOCUS_RADIUS_PX)
        .min_by(|(_, da), (_, db)| cmp_dist(*da, *db))
        .map(|(el, _)| el)
}

/// Resolve the focused element plus its `n` nearest neighbours.
///
/// The focused element is resolved exactly as [`focused_element`]. Neighbours
/// are the next-nearest elements by centre distance — excluding the focused one
/// — capped at `n` and ordered nearest-first. When nothing is focused,
/// neighbours are still ranked from the gaze point, so a deictic command can
/// resolve against the closest thing the eye was near.
pub fn focus_context<'a>(
    gaze: GazePoint,
    elements: &'a [ScreenElement],
    n: usize,
) -> FocusContext<'a> {
    let focused = focused_element(gaze, elements);

    // Rank every other element by centre distance, nearest first. Identity, not
    // value, decides exclusion so duplicate-looking elements aren't dropped.
    let focused_ptr = focused.map(|f| f as *const ScreenElement);
    let mut ranked: Vec<&ScreenElement> = elements
        .iter()
        .filter(|el| focused_ptr != Some(*el as *const ScreenElement))
        .collect();
    ranked.sort_by(|a, b| cmp_dist(distance_to_center(gaze, a), distance_to_center(gaze, b)));
    ranked.truncate(n);

    FocusContext {
        focused,
        neighbors: ranked,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::screen_extract::element::{BBox, ElementSource, ScreenElement};

    fn el(id: &str, x: f64, y: f64, w: f64, h: f64) -> ScreenElement {
        ScreenElement {
            id: id.into(),
            role: "button".into(),
            label: id.into(),
            bbox: BBox::new(x, y, w, h),
            interactable: true,
            text: None,
            source: ElementSource::Ax,
        }
    }

    fn gaze(x: f64, y: f64) -> GazePoint {
        GazePoint {
            x,
            y,
            confidence: 1.0,
            ts_ms: 0,
        }
    }

    #[test]
    fn point_inside_element_selects_it() {
        let elements = vec![el("a", 0.1, 0.1, 0.2, 0.2), el("b", 0.6, 0.6, 0.2, 0.2)];
        let hit = focused_element(gaze(0.2, 0.2), &elements).expect("a hit");
        assert_eq!(hit.id, "a");
    }

    #[test]
    fn point_just_outside_selects_nearest_within_radius() {
        // Element "a" spans x∈[0.1,0.3]; gaze at x=0.32 is just past its right
        // edge — inside no element, but only 0.02 from the edge (within radius
        // measured to the bounds, even though the centre is 0.12 away).
        let elements = vec![el("a", 0.1, 0.1, 0.2, 0.2), el("b", 0.7, 0.7, 0.2, 0.2)];
        let hit = focused_element(gaze(0.32, 0.2), &elements).expect("a hit by radius");
        assert_eq!(hit.id, "a");
    }

    #[test]
    fn point_far_from_everything_is_none() {
        let elements = vec![el("a", 0.0, 0.0, 0.1, 0.1), el("b", 0.1, 0.1, 0.1, 0.1)];
        // Gaze in the far corner, well beyond FOCUS_RADIUS_PX of either centre.
        assert!(focused_element(gaze(0.9, 0.9), &elements).is_none());
    }

    #[test]
    fn overlapping_containers_pick_nearest_center() {
        // A big panel and a small control both contain the gaze and share the
        // same centre (0.3,0.3); the tiebreak prefers the smaller (tighter) box
        // so the eye resolves to the control, not the panel behind it.
        let big = el("big", 0.0, 0.0, 0.6, 0.6);
        let small = el("small", 0.25, 0.25, 0.1, 0.1);
        let elements = vec![big, small];
        let hit = focused_element(gaze(0.3, 0.3), &elements).expect("a hit");
        assert_eq!(hit.id, "small");
    }

    #[test]
    fn radius_is_measured_to_bounds_not_center() {
        // A wide element whose centre is far from the eye, but whose near edge
        // is within radius. Distance-to-bounds must resolve it; distance-to-
        // centre would (wrongly) reject it.
        let wide = el("wide", 0.0, 0.45, 0.4, 0.1); // edge at x=0.4, centre x=0.2
        let elements = vec![wide];
        // Gaze at x=0.42: 0.02 past the edge (in radius), but 0.22 from centre.
        let hit = focused_element(gaze(0.42, 0.5), &elements).expect("hit by bounds");
        assert_eq!(hit.id, "wide");
    }

    #[test]
    fn empty_elements_resolve_to_none() {
        let elements: Vec<ScreenElement> = vec![];
        assert!(focused_element(gaze(0.5, 0.5), &elements).is_none());
    }

    #[test]
    fn focus_context_returns_focused_and_ranked_neighbors() {
        // Gaze inside "a"; b, c, d at increasing distance.
        let elements = vec![
            el("a", 0.10, 0.10, 0.10, 0.10), // center (0.15,0.15)
            el("b", 0.20, 0.20, 0.10, 0.10), // center (0.25,0.25)
            el("c", 0.40, 0.40, 0.10, 0.10), // center (0.45,0.45)
            el("d", 0.70, 0.70, 0.10, 0.10), // center (0.75,0.75)
        ];
        let ctx = focus_context(gaze(0.15, 0.15), &elements, 2);
        assert_eq!(ctx.focused.map(|e| e.id.as_str()), Some("a"));
        // Two nearest non-focused, nearest first.
        let ids: Vec<&str> = ctx.neighbors.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["b", "c"]);
    }

    #[test]
    fn focus_context_excludes_focused_from_neighbors() {
        let elements = vec![
            el("a", 0.10, 0.10, 0.10, 0.10),
            el("b", 0.20, 0.20, 0.10, 0.10),
        ];
        let ctx = focus_context(gaze(0.15, 0.15), &elements, 5);
        assert_eq!(ctx.focused.map(|e| e.id.as_str()), Some("a"));
        // Only "b" remains; "a" (focused) is not duplicated into neighbors.
        let ids: Vec<&str> = ctx.neighbors.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["b"]);
    }

    #[test]
    fn focus_context_ranks_neighbors_when_nothing_focused() {
        // Gaze in empty space: no focus, but neighbours still ranked from gaze.
        let elements = vec![
            el("near", 0.50, 0.50, 0.05, 0.05), // center (0.525,0.525)
            el("far", 0.0, 0.0, 0.05, 0.05),    // center (0.025,0.025)
        ];
        let ctx = focus_context(gaze(0.6, 0.6), &elements, 5);
        assert!(ctx.focused.is_none());
        let ids: Vec<&str> = ctx.neighbors.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["near", "far"]);
    }

    #[test]
    fn focus_context_empty_elements_is_empty() {
        let elements: Vec<ScreenElement> = vec![];
        let ctx = focus_context(gaze(0.5, 0.5), &elements, 3);
        assert!(ctx.focused.is_none());
        assert!(ctx.neighbors.is_empty());
    }

    #[test]
    fn focus_context_caps_neighbors_at_n() {
        let elements = vec![
            el("a", 0.10, 0.10, 0.05, 0.05),
            el("b", 0.20, 0.20, 0.05, 0.05),
            el("c", 0.30, 0.30, 0.05, 0.05),
            el("d", 0.40, 0.40, 0.05, 0.05),
        ];
        let ctx = focus_context(gaze(0.125, 0.125), &elements, 1);
        assert_eq!(ctx.neighbors.len(), 1);
    }

    #[test]
    fn equidistant_neighbors_are_handled_without_panic() {
        // Two elements exactly equidistant from the gaze point: a tie must be
        // resolved deterministically (stable sort keeps input order) and never
        // panic.
        let elements = vec![
            el("left", 0.30, 0.40, 0.10, 0.10),
            el("right", 0.60, 0.40, 0.10, 0.10),
        ];
        // Gaze centred between the two centres (0.35,0.45) and (0.65,0.45).
        let ctx = focus_context(gaze(0.50, 0.45), &elements, 5);
        let ids: Vec<&str> = ctx.neighbors.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["left", "right"]);
    }
}
