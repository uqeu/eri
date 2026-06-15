//! The on-device screen-extractor element schema.
//!
//! A [`ScreenElement`] is one structured UI element pulled out of a captured
//! screen frame: a role (button/text/link/…), a human-readable label, a
//! normalised bounding box, whether it's interactable, optional inner text, and
//! which extractor produced it.
//!
//! This struct is the **JSON-per-line contract** between the Swift capture
//! sidecar and the Rust service: the sidecar emits one `ScreenElement` per
//! line, the service parses + fuses them. It is also what eri hands Claude (via
//! the compact prompt list) — eri only *extracts*; Claude *reasons* over the
//! marked screenshot and the list.
//!
//! WHY this lives in Rust and not the sidecar: the capture itself
//! (ScreenCaptureKit + `AXUIElement` walk + Apple Vision OCR) is a macOS-native
//! layer that can only run on-device, so it's a deferred Swift sidecar STUB.
//! The schema, fusion, and Set-of-Mark math are pure + deterministic, so they
//! live here and are unit-tested without a screen.

use serde::{Deserialize, Serialize};

/// A normalised bounding box. All four fields are in `[0.0, 1.0]` relative to
/// the captured frame — never raw pixels, so downstream math is
/// resolution-independent and the frame never has to cross into Rust.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl BBox {
    /// Construct a bbox, clamping every field into `[0,1]` and forcing
    /// non-negative extent. Untrusted sidecar input flows through here so the
    /// rest of the pipeline can assume well-formed boxes.
    pub fn new(x: f64, y: f64, w: f64, h: f64) -> Self {
        let x = clamp01(x);
        let y = clamp01(y);
        // Width/height can't push the box past the frame edge.
        let w = clamp01(w).min(1.0 - x);
        let h = clamp01(h).min(1.0 - y);
        Self { x, y, w, h }
    }

    /// Area in normalised units. Zero for a degenerate box.
    pub fn area(&self) -> f64 {
        (self.w * self.h).max(0.0)
    }

    /// Centre point `(cx, cy)` — used as the click target and as the default
    /// Set-of-Mark label anchor.
    pub fn center(&self) -> (f64, f64) {
        (self.x + self.w / 2.0, self.y + self.h / 2.0)
    }

    /// Intersection-over-Union with another box. `0.0` when they don't overlap,
    /// `1.0` when identical. This is the dedupe signal in [`super::fuse`].
    pub fn iou(&self, other: &BBox) -> f64 {
        let ix0 = self.x.max(other.x);
        let iy0 = self.y.max(other.y);
        let ix1 = (self.x + self.w).min(other.x + other.w);
        let iy1 = (self.y + self.h).min(other.y + other.h);
        let iw = (ix1 - ix0).max(0.0);
        let ih = (iy1 - iy0).max(0.0);
        let inter = iw * ih;
        if inter <= 0.0 {
            return 0.0;
        }
        let union = self.area() + other.area() - inter;
        if union <= 0.0 { 0.0 } else { inter / union }
    }
}

/// Which on-device extractor produced an element. Precedence in fusion is
/// `Ax > Ocr > Vision` for geometry/role; labels/text are filled from whichever
/// source has them (see [`super::fuse`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ElementSource {
    /// macOS Accessibility (`AXUIElement`) — exact geometry/role, token-cheap,
    /// the PRIMARY signal. Gap: ~40% of apps expose no AX (Electron/canvas).
    Ax,
    /// Apple Vision `VNRecognizeTextRequest` OCR — text + boxes AX missed.
    Ocr,
    /// Permissive ML detector (Florence-2 / Screen2AX-style) for interactable
    /// elements AX missed. The P1 LocateAnything replacement.
    Vision,
}

impl ElementSource {
    /// Geometry/role precedence rank — lower wins. Drives which element keeps
    /// its bbox + role when two sources describe the same on-screen thing.
    fn rank(self) -> u8 {
        match self {
            ElementSource::Ax => 0,
            ElementSource::Ocr => 1,
            ElementSource::Vision => 2,
        }
    }
}

/// One structured UI element extracted from a screen frame.
///
/// `id` is assigned by [`super::fuse`] (stable + unique within a fused frame);
/// sidecar-emitted elements may carry an empty or duplicate id, which fusion
/// overwrites.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScreenElement {
    /// Stable, unique id within a fused frame (e.g. `el-0`). Assigned by fusion.
    #[serde(default)]
    pub id: String,
    /// Accessibility-style role: `button`, `text`, `link`, `textfield`, …
    pub role: String,
    /// Human-readable label (AX name, or OCR/vision-derived).
    #[serde(default)]
    pub label: String,
    /// Normalised bounding box.
    pub bbox: BBox,
    /// Whether the element accepts a click/type. Only these get Set-of-Mark
    /// numbers; pure-text elements are context, not targets.
    #[serde(default)]
    pub interactable: bool,
    /// Inner text content (OCR), distinct from the short `label`.
    #[serde(default)]
    pub text: Option<String>,
    /// Which extractor produced this element.
    pub source: ElementSource,
}

impl ScreenElement {
    /// True when `other` describes the same on-screen element as `self`,
    /// judged by bbox overlap exceeding `iou_threshold`.
    pub fn overlaps(&self, other: &ScreenElement, iou_threshold: f64) -> bool {
        self.bbox.iou(&other.bbox) > iou_threshold
    }

    /// Geometry/role precedence — lower wins, ties broken by larger area so the
    /// fuller box survives a merge.
    pub(crate) fn precedence(&self) -> (u8, f64) {
        // Negative area so that, sorted ascending, the larger box ranks first.
        (self.source.rank(), -self.bbox.area())
    }
}

/// Clamp into `[0,1]`, mapping `NaN` to `0.0` so bad sidecar floats can never
/// produce a `NaN` bbox.
pub(crate) fn clamp01(v: f64) -> f64 {
    if v.is_nan() { 0.0 } else { v.clamp(0.0, 1.0) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bbox_new_clamps_into_unit_square() {
        let b = BBox::new(-0.2, 0.5, 2.0, 0.9);
        assert_eq!(b.x, 0.0);
        assert_eq!(b.y, 0.5);
        // width clamped to 1, then capped at 1 - x = 1.0
        assert_eq!(b.w, 1.0);
        // height capped at 1 - y = 0.5
        assert_eq!(b.h, 0.5);
    }

    #[test]
    fn bbox_new_maps_nan_to_zero() {
        let b = BBox::new(f64::NAN, f64::NAN, f64::NAN, f64::NAN);
        assert_eq!(
            b,
            BBox {
                x: 0.0,
                y: 0.0,
                w: 0.0,
                h: 0.0
            }
        );
    }

    #[test]
    fn iou_identical_is_one() {
        let a = BBox::new(0.1, 0.1, 0.2, 0.2);
        assert!((a.iou(&a) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn iou_disjoint_is_zero() {
        let a = BBox::new(0.0, 0.0, 0.1, 0.1);
        let b = BBox::new(0.5, 0.5, 0.1, 0.1);
        assert_eq!(a.iou(&b), 0.0);
    }

    #[test]
    fn iou_half_overlap_is_one_third() {
        // Two unit-ish boxes overlapping on half their area → IoU = 1/3.
        let a = BBox::new(0.0, 0.0, 0.2, 0.2);
        let b = BBox::new(0.1, 0.0, 0.2, 0.2);
        // inter = 0.1*0.2 = 0.02; union = 0.04 + 0.04 - 0.02 = 0.06; 0.02/0.06
        assert!((a.iou(&b) - (1.0 / 3.0)).abs() < 1e-9);
    }

    #[test]
    fn center_is_box_middle() {
        let (cx, cy) = BBox::new(0.2, 0.4, 0.2, 0.2).center();
        assert!((cx - 0.3).abs() < 1e-9);
        assert!((cy - 0.5).abs() < 1e-9);
    }

    #[test]
    fn source_rank_orders_ax_first() {
        assert!(ElementSource::Ax.rank() < ElementSource::Ocr.rank());
        assert!(ElementSource::Ocr.rank() < ElementSource::Vision.rank());
    }

    #[test]
    fn json_round_trip_preserves_element() {
        let el = ScreenElement {
            id: "el-3".into(),
            role: "button".into(),
            label: "Send".into(),
            bbox: BBox::new(0.1, 0.2, 0.3, 0.05),
            interactable: true,
            text: Some("Send".into()),
            source: ElementSource::Ax,
        };
        let json = serde_json::to_string(&el).expect("serialise");
        let back: ScreenElement = serde_json::from_str(&json).expect("deserialise");
        assert_eq!(el, back);
    }

    #[test]
    fn json_deserialises_with_minimal_fields_and_defaults() {
        // The sidecar contract: id/label/interactable/text are optional.
        let line = r#"{"role":"text","bbox":{"x":0.0,"y":0.0,"w":0.5,"h":0.1},"source":"ocr"}"#;
        let el: ScreenElement = serde_json::from_str(line).expect("parse minimal");
        assert_eq!(el.role, "text");
        assert_eq!(el.id, "");
        assert_eq!(el.label, "");
        assert!(!el.interactable);
        assert!(el.text.is_none());
        assert_eq!(el.source, ElementSource::Ocr);
    }

    #[test]
    fn source_serialises_lowercase() {
        let json = serde_json::to_string(&ElementSource::Vision).expect("ser");
        assert_eq!(json, "\"vision\"");
    }
}
