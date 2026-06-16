//! Gaze-focus context for the control loop — "what you're looking at" fused
//! into the deictic-command resolver.
//!
//! eri's perception stack already answers two questions independently: the
//! gaze pipeline (`eri_coreutils::services::gaze`) says WHERE the eye is
//! pointing (a normalised `[0,1]` point), and the control bridge's
//! [`ScreenGraph`] says WHAT is on screen (the AX element list). This module
//! fuses them so a hands-free deictic command — "click that", "what's this",
//! "do that" — resolves to the element the user is actually looking at, plus
//! its nearby neighbours for disambiguation.
//!
//! ## Where the gaze comes from (the seam)
//!
//! The live gaze feed is owned by the macOS app, which runs the tracker AND
//! exposes the AX snapshot over the control bridge. The bridge therefore grows
//! an optional [`ControlBridge::gaze`](crate::control_agent::ControlBridge::gaze)
//! method that returns `Option<GazePoint>`, defaulting to `None`. Until the app
//! sends a gaze point this is always `None`, so the loop behaves exactly as it
//! did before (no focus block). The moment the app feeds gaze, this lights up.
//!
//! **[user]/app-side follow-up:** feed live gaze — the macOS app must answer a
//! `{"kind":"gaze"}` bridge request with the latest normalised point (and the
//! snapshot must carry `screen` bounds so AX pixel frames can be normalised).
//!
//! ## Coordinate spaces (why we need screen bounds)
//!
//! The gaze point is normalised `[0,1]`. The control loop's [`AxElement`] frames
//! are macOS screen POINTS (pixels), not normalised. To compare the two we must
//! put them in the same space, so [`focus_note`] normalises each frame against
//! the [`ScreenGraph::screen`] bounds the snapshot carries. No bounds → we can't
//! normalise → no focus block (best-effort, never a guess).
//!
//! ## Reuse, not reimplementation
//!
//! The geometry (point-in-rect, centre/bounds distance, neighbour ranking) lives
//! in `eri_coreutils`'s `focus.rs` and is reused verbatim. This module only
//! BRIDGES the control loop's [`AxElement`] into the `ScreenElement` that
//! [`focus_context`] consumes, then renders the resolved focus into a concise
//! note. The render is pure (gaze + graph in, `Option<String>` out) and is the
//! unit under test; the loop wiring just calls it.

use eri_coreutils::services::gaze::GazePoint;
use eri_coreutils::services::screen_extract::{BBox, ElementSource, ScreenElement, focus_context};

use crate::control_agent::{AxElement, ScreenGraph};

/// How many nearby elements to name alongside the focused one. Enough to
/// disambiguate "the button next to it" without bloating the note.
const NEIGHBOR_COUNT: usize = 3;

/// Render the "what you're looking at" note for the control loop, or `None`
/// when there's nothing useful to say.
///
/// Returns `None` (no focus block, loop behaves as before) when ANY of:
/// * no gaze point (`gaze` is `None`) — the app isn't feeding gaze yet,
/// * the snapshot carries no `screen` bounds — we can't normalise the frames,
/// * the screen bounds are degenerate (zero width/height),
/// * there are no elements on screen, or
/// * the gaze resolves to neither a focused element nor any neighbour
///   (genuine empty space with nothing nearby).
///
/// Otherwise it names the focused element (role + label + id) and up to
/// [`NEIGHBOR_COUNT`] nearby elements, so the model can bind a deictic command
/// to a concrete target.
pub fn focus_note(gaze: Option<GazePoint>, graph: &ScreenGraph) -> Option<String> {
    let gaze = gaze?;
    let screen = graph.screen?;
    let elements = to_screen_elements(graph, screen)?;
    if elements.is_empty() {
        return None;
    }

    let ctx = focus_context(gaze, &elements, NEIGHBOR_COUNT);
    // Nothing under or near the eye, and nothing close enough to fall back to:
    // stay silent rather than inject a misleading "you're looking at" line.
    if ctx.focused.is_none() && ctx.neighbors.is_empty() {
        return None;
    }

    let mut body = match ctx.focused {
        Some(el) => format!("You're looking at: {}", describe(el)),
        None => "You're looking near (nothing directly under your gaze):".to_string(),
    };
    if !ctx.neighbors.is_empty() {
        let nearby: Vec<String> = ctx.neighbors.iter().map(|el| describe(el)).collect();
        body.push_str(&format!("\nnearby: {}", nearby.join(", ")));
    }

    Some(format!(
        "<eri:focus note=\"where the user is looking — resolve deictic commands \
         (\\\"click that\\\", \\\"what's this\\\") against this; context only\">\n\
         {body}\n\
         </eri:focus>"
    ))
}

/// One element rendered for the note: `role "label" (id N)`. Falls back
/// gracefully when a label is empty so the line is still actionable by id.
fn describe(el: &ScreenElement) -> String {
    if el.label.trim().is_empty() {
        format!("{} (id {})", el.role, el.id)
    } else {
        format!("{} \"{}\" (id {})", el.role, el.label, el.id)
    }
}

/// Bridge the control loop's [`AxElement`] list into the normalised
/// [`ScreenElement`] list that `focus.rs` consumes — the ONLY translation this
/// module owns. Each AX frame (`[x, y, w, h]` in screen points) is normalised
/// against `screen` (also `[x, y, w, h]` in points) so it shares the gaze
/// point's `[0,1]` space; [`BBox::new`] then clamps it well-formed.
///
/// Returns `None` when `screen` is degenerate (zero extent) — we can't divide by
/// zero, and a zero-size screen can't contain a gaze point anyway.
fn to_screen_elements(graph: &ScreenGraph, screen: [f32; 4]) -> Option<Vec<ScreenElement>> {
    let [_, _, sw, sh] = screen;
    if sw <= 0.0 || sh <= 0.0 {
        return None;
    }
    let elements = graph
        .elements
        .iter()
        .map(|ax| to_screen_element(ax, screen))
        .collect();
    Some(elements)
}

/// Convert a single [`AxElement`] to a normalised [`ScreenElement`]. The frame's
/// origin is shifted by the screen origin (so a multi-display offset doesn't
/// skew normalisation) and divided by the screen extent.
fn to_screen_element(ax: &AxElement, screen: [f32; 4]) -> ScreenElement {
    let [sx, sy, sw, sh] = screen;
    let [fx, fy, fw, fh] = ax.frame;
    let bbox = BBox::new(
        ((fx - sx) / sw) as f64,
        ((fy - sy) / sh) as f64,
        (fw / sw) as f64,
        (fh / sh) as f64,
    );
    ScreenElement {
        id: ax.id.clone(),
        role: ax.role.clone(),
        label: ax.label.clone(),
        bbox,
        interactable: ax.actionable,
        text: None,
        // These elements originate from the AX screen graph, so attribute them
        // to the AX source for any downstream precedence logic.
        source: ElementSource::Ax,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gaze(x: f64, y: f64) -> GazePoint {
        GazePoint {
            x,
            y,
            confidence: 1.0,
            ts_ms: 0,
        }
    }

    /// A 1000x1000 screen so screen-point frames map 1:1 onto normalised
    /// hundredths (frame 100 → 0.1), keeping the test arithmetic obvious.
    fn screen_1000() -> [f32; 4] {
        [0.0, 0.0, 1000.0, 1000.0]
    }

    fn ax(id: &str, role: &str, label: &str, frame: [f32; 4]) -> AxElement {
        AxElement {
            id: id.into(),
            role: role.into(),
            label: label.into(),
            actionable: true,
            frame,
        }
    }

    fn graph_with(elements: Vec<AxElement>, screen: Option<[f32; 4]>) -> ScreenGraph {
        ScreenGraph {
            app: "TestApp".into(),
            window: "Main".into(),
            elements,
            screen,
        }
    }

    #[test]
    fn no_gaze_yields_no_note() {
        // The seam's default state (app not feeding gaze): identical to today.
        let g = graph_with(
            vec![ax("e1", "button", "Send", [100.0, 100.0, 200.0, 50.0])],
            Some(screen_1000()),
        );
        assert!(focus_note(None, &g).is_none());
    }

    #[test]
    fn no_screen_bounds_yields_no_note() {
        // Gaze present, but the snapshot can't tell us how to normalise frames.
        let g = graph_with(
            vec![ax("e1", "button", "Send", [100.0, 100.0, 200.0, 50.0])],
            None,
        );
        assert!(focus_note(Some(gaze(0.2, 0.2)), &g).is_none());
    }

    #[test]
    fn degenerate_screen_yields_no_note() {
        let g = graph_with(
            vec![ax("e1", "button", "Send", [100.0, 100.0, 200.0, 50.0])],
            Some([0.0, 0.0, 0.0, 0.0]),
        );
        assert!(focus_note(Some(gaze(0.2, 0.2)), &g).is_none());
    }

    #[test]
    fn empty_elements_yields_no_note() {
        let g = graph_with(vec![], Some(screen_1000()));
        assert!(focus_note(Some(gaze(0.5, 0.5)), &g).is_none());
    }

    #[test]
    fn gaze_inside_element_names_that_element() {
        // "Send" spans normalised x∈[0.1,0.3], y∈[0.1,0.15]; gaze at (0.2,0.12)
        // lands inside it. A far-away "Cancel" is the only neighbour.
        let g = graph_with(
            vec![
                ax("e1", "button", "Send", [100.0, 100.0, 200.0, 50.0]),
                ax("e2", "button", "Cancel", [800.0, 800.0, 100.0, 50.0]),
            ],
            Some(screen_1000()),
        );
        let note = focus_note(Some(gaze(0.2, 0.12)), &g).expect("a focus note");
        assert!(
            note.contains("You're looking at: button \"Send\" (id e1)"),
            "{note}"
        );
        assert!(note.contains("nearby: button \"Cancel\" (id e2)"), "{note}");
        assert!(
            note.contains("<eri:focus"),
            "fenced as a focus note: {note}"
        );
    }

    #[test]
    fn gaze_near_element_resolves_to_nearest_within_radius() {
        // Gaze just past the right edge of "Send" (within the focus radius),
        // and far from "Cancel" — must still resolve to "Send".
        let g = graph_with(
            vec![
                ax("e1", "button", "Send", [100.0, 100.0, 200.0, 50.0]),
                ax("e2", "button", "Cancel", [800.0, 800.0, 100.0, 50.0]),
            ],
            Some(screen_1000()),
        );
        // "Send" right edge is at x=0.3; gaze at x=0.32 is 0.02 past it (< 0.04).
        let note = focus_note(Some(gaze(0.32, 0.12)), &g).expect("a focus note");
        assert!(
            note.contains("You're looking at: button \"Send\" (id e1)"),
            "{note}"
        );
    }

    #[test]
    fn gaze_in_empty_space_still_offers_nearest_neighbor() {
        // Nothing under the eye and nothing within the focus radius, but there
        // ARE elements: we fall back to naming the nearest as a neighbour so a
        // deictic command has something to bind to.
        let g = graph_with(
            vec![ax("e1", "button", "Send", [100.0, 100.0, 50.0, 50.0])],
            Some(screen_1000()),
        );
        let note = focus_note(Some(gaze(0.9, 0.9)), &g).expect("a near note");
        assert!(
            note.contains("looking near"),
            "no direct focus, framed as 'near': {note}"
        );
        assert!(note.contains("nearby: button \"Send\" (id e1)"), "{note}");
    }

    #[test]
    fn frames_are_normalised_against_screen_bounds() {
        // A non-unit screen (1920x1080) with a non-zero origin: a frame at
        // (192,108) size (192,108) normalises to x=0.1,y=0.1,w=0.1,h=0.1.
        // Gaze at (0.15,0.15) lands inside it; correctness of the bridge math
        // is what's under test here.
        let g = graph_with(
            vec![ax("e1", "link", "Docs", [192.0, 108.0, 192.0, 108.0])],
            Some([0.0, 0.0, 1920.0, 1080.0]),
        );
        let note = focus_note(Some(gaze(0.15, 0.15)), &g).expect("a focus note");
        assert!(note.contains("link \"Docs\" (id e1)"), "{note}");
    }

    #[test]
    fn screen_origin_offset_is_subtracted() {
        // Secondary display at origin (1920,0): a frame at (2016,108) is 96px
        // into that display → normalises to x=(2016-1920)/1920=0.05.
        let g = graph_with(
            vec![ax("e1", "button", "OK", [2016.0, 108.0, 192.0, 108.0])],
            Some([1920.0, 0.0, 1920.0, 1080.0]),
        );
        // Box spans x∈[0.05,0.15], y∈[0.1,0.2]; gaze at (0.1,0.15) is inside.
        let note = focus_note(Some(gaze(0.1, 0.15)), &g).expect("a focus note");
        assert!(note.contains("button \"OK\" (id e1)"), "{note}");
    }

    #[test]
    fn unlabeled_element_falls_back_to_role_and_id() {
        let g = graph_with(
            vec![ax("e7", "image", "", [100.0, 100.0, 200.0, 200.0])],
            Some(screen_1000()),
        );
        let note = focus_note(Some(gaze(0.2, 0.2)), &g).expect("a focus note");
        assert!(note.contains("image (id e7)"), "{note}");
        assert!(!note.contains("\"\""), "no empty-quote label: {note}");
    }

    #[test]
    fn bridge_maps_ax_fields_into_screen_element() {
        // Direct check of the field bridge: role/label/id/actionable carried,
        // frame normalised, source attributed to AX.
        let el = to_screen_element(
            &ax("e1", "textfield", "Search", [250.0, 500.0, 500.0, 100.0]),
            screen_1000(),
        );
        assert_eq!(el.id, "e1");
        assert_eq!(el.role, "textfield");
        assert_eq!(el.label, "Search");
        assert!(el.interactable);
        assert_eq!(el.source, ElementSource::Ax);
        assert!((el.bbox.x - 0.25).abs() < 1e-6, "x={}", el.bbox.x);
        assert!((el.bbox.y - 0.5).abs() < 1e-6, "y={}", el.bbox.y);
        assert!((el.bbox.w - 0.5).abs() < 1e-6, "w={}", el.bbox.w);
        assert!((el.bbox.h - 0.1).abs() < 1e-6, "h={}", el.bbox.h);
    }
}
