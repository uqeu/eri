//! Set-of-Mark: number the interactable elements so Claude can say "click #N".
//!
//! Set-of-Mark prompting overlays sequential numbers on the clickable elements
//! of a screenshot and hands Claude a matching numbered list. Claude reasons
//! over the marked image + list and replies with a number; eri maps that number
//! back to a bbox centre and clicks via the computer-use MCP. eri only produces
//! the marks + list here — the actual numbered-PNG render is a follow-up that
//! can reuse `crates/eri_images` or a Swift overlay.
//!
//! Only **interactable** elements get numbers — pure-text elements are context
//! for Claude, not click targets, so numbering them would waste numbers and
//! invite mis-clicks on non-targets.
//!
//! Pure + deterministic.

use serde::{Deserialize, Serialize};

use super::element::{BBox, ScreenElement};

/// One numbered mark over an interactable element. `set_of_mark` returns these
/// so callers can map `#N → element_id → bbox center → click` without a second
/// pass over the element list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Mark {
    /// 1-based sequence number shown on the screenshot + in the prompt list.
    pub number: usize,
    /// `ScreenElement::id` this mark points at — the join key back to geometry.
    pub element_id: String,
    /// Copy of the element's bbox so the renderer/clicker doesn't need a second
    /// lookup. Centre of this box is the click target.
    pub bbox: BBox,
    /// Where to draw the number badge: `(x, y)` normalised. Anchored at the
    /// box's top-left, nudged just inside, so the badge sits on the element
    /// without covering its centre.
    pub label_anchor: (f64, f64),
}

/// Assign sequential 1-based numbers to the **interactable** elements, in their
/// existing list order, and compute a label anchor for each.
///
/// Pure-text elements are skipped (no number). Output order matches input order
/// of the interactable elements, so numbering is stable for a stable fused
/// list.
pub fn set_of_mark(elements: &[ScreenElement]) -> Vec<Mark> {
    elements
        .iter()
        .filter(|e| e.interactable)
        .enumerate()
        .map(|(idx, e)| Mark {
            number: idx + 1,
            element_id: e.id.clone(),
            bbox: e.bbox,
            label_anchor: label_anchor(&e.bbox),
        })
        .collect()
}

/// Anchor the number badge just inside the element's top-left corner. We nudge
/// inward by a small fraction of the box so the badge overlaps the element
/// (associating the number with it) without sitting on the click centre.
fn label_anchor(bbox: &BBox) -> (f64, f64) {
    const INSET: f64 = 0.1;
    let ax = bbox.x + bbox.w * INSET;
    let ay = bbox.y + bbox.h * INSET;
    (ax, ay)
}

/// Render the compact numbered listing eri hands Claude alongside the marked
/// screenshot. One line per mark:
///
/// ```text
/// 1: button 'Submit' [interactable]
/// 2: link 'Docs' [interactable]
/// ```
///
/// Non-interactable elements (which carry no mark) are appended as unnumbered
/// context lines so Claude still has the on-screen text, e.g.:
///
/// ```text
/// - text 'Welcome back'
/// ```
pub fn to_prompt_list(marks: &[Mark], elements: &[ScreenElement]) -> String {
    let mut lines: Vec<String> = Vec::with_capacity(elements.len());

    // Numbered interactable lines, in mark order.
    for mark in marks {
        if let Some(el) = elements.iter().find(|e| e.id == mark.element_id) {
            lines.push(format!(
                "{}: {} '{}' [interactable]",
                mark.number,
                el.role,
                display_label(el)
            ));
        }
    }

    // Unnumbered context lines for the pure-text elements.
    for el in elements.iter().filter(|e| !e.interactable) {
        lines.push(format!("- {} '{}'", el.role, display_label(el)));
    }

    lines.join("\n")
}

/// Best label for the prompt: prefer the short `label`, fall back to inner
/// `text`, else empty.
fn display_label(el: &ScreenElement) -> &str {
    if !el.label.trim().is_empty() {
        &el.label
    } else {
        el.text
            .as_deref()
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::screen_extract::element::{BBox, ElementSource};

    fn el(id: &str, role: &str, label: &str, interactable: bool) -> ScreenElement {
        ScreenElement {
            id: id.into(),
            role: role.into(),
            label: label.into(),
            bbox: BBox::new(0.2, 0.3, 0.2, 0.1),
            interactable,
            text: None,
            source: ElementSource::Ax,
        }
    }

    #[test]
    fn set_of_mark_numbers_only_interactables_sequentially() {
        let els = vec![
            el("el-0", "text", "Heading", false),
            el("el-1", "button", "OK", true),
            el("el-2", "text", "Body", false),
            el("el-3", "link", "More", true),
        ];
        let marks = set_of_mark(&els);
        assert_eq!(marks.len(), 2, "only interactables get marks");
        assert_eq!(marks[0].number, 1);
        assert_eq!(marks[0].element_id, "el-1");
        assert_eq!(marks[1].number, 2);
        assert_eq!(marks[1].element_id, "el-3");
    }

    #[test]
    fn set_of_mark_empty_when_no_interactables() {
        let els = vec![el("el-0", "text", "x", false)];
        assert!(set_of_mark(&els).is_empty());
    }

    #[test]
    fn label_anchor_is_inside_top_left() {
        let b = BBox::new(0.2, 0.3, 0.2, 0.1);
        let (ax, ay) = label_anchor(&b);
        // Inside the box, near the top-left.
        assert!(ax > b.x && ax < b.x + b.w);
        assert!(ay > b.y && ay < b.y + b.h);
        assert!((ax - (0.2 + 0.02)).abs() < 1e-9);
        assert!((ay - (0.3 + 0.01)).abs() < 1e-9);
    }

    #[test]
    fn to_prompt_list_formats_numbered_then_context() {
        let els = vec![
            el("el-0", "text", "Welcome", false),
            el("el-1", "button", "Submit", true),
            el("el-2", "link", "Docs", true),
        ];
        let marks = set_of_mark(&els);
        let listing = to_prompt_list(&marks, &els);
        let expected = "1: button 'Submit' [interactable]\n\
                        2: link 'Docs' [interactable]\n\
                        - text 'Welcome'";
        assert_eq!(listing, expected);
    }

    #[test]
    fn to_prompt_list_falls_back_to_text_when_no_label() {
        let mut e = el("el-0", "button", "", true);
        e.text = Some("Click here".into());
        let marks = set_of_mark(std::slice::from_ref(&e));
        let listing = to_prompt_list(&marks, std::slice::from_ref(&e));
        assert_eq!(listing, "1: button 'Click here' [interactable]");
    }

    #[test]
    fn to_prompt_list_empty_for_empty_inputs() {
        assert_eq!(to_prompt_list(&[], &[]), "");
    }
}
