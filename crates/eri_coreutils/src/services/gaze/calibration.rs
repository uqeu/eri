//! Gaze calibration profile + smoothing, mirrored from the Python sidecar.
//!
//! WHY this lives in Rust too
//! --------------------------
//! The Python sidecar (`scripts/eri_gaze_calibration.py`) fits the per-user
//! ridge regression and *writes* the profile. Rust *reads* it: to report
//! `calibrated` status honestly in `eri/gaze/status`, and so the parsed gaze
//! stream can be smoothed Rust-side if a consumer wants it. Keeping the
//! profile schema + the evaluation math here (not just in Python) means the
//! contract is unit-tested on both sides of the pipe, and a future
//! Rust/Swift inference path can reuse the same evaluator.
//!
//! The profile JSON schema is the one the Python side emits:
//! ```json
//! { "version": 1, "lambda": 0.01, "feature_dim": 5,
//!   "targets": 9, "samples": 180,
//!   "coeffs": [[bx, by], [c1x, c1y], ...] }   // (feature_dim+1) x 2
//! ```

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Feature-vector dimension shared with the Python sidecar
/// (`build_features`: `[rx, ry, rx², ry², rx·ry]`). The bias term is a leading
/// coefficient row, so `coeffs` has `FEATURE_DIM + 1` rows.
pub const FEATURE_DIM: usize = 5;

/// The nine calibration targets as screen fractions `[0,1]`
/// (corners, edge-midpoints, centre). Kept in lockstep with the Python side.
pub const NINE_TARGETS: [(f64, f64); 9] = [
    (0.1, 0.1),
    (0.5, 0.1),
    (0.9, 0.1),
    (0.1, 0.5),
    (0.5, 0.5),
    (0.9, 0.5),
    (0.1, 0.9),
    (0.5, 0.9),
    (0.9, 0.9),
];

/// A fitted per-user gaze calibration profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalibrationProfile {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub targets: u32,
    #[serde(default)]
    pub samples: u32,
    #[serde(default = "default_feature_dim")]
    pub feature_dim: usize,
    /// `(feature_dim + 1) x 2` coefficient matrix (rows: bias then features;
    /// cols: x then y).
    pub coeffs: Vec<Vec<f64>>,
}

fn default_version() -> u32 {
    1
}
fn default_feature_dim() -> usize {
    FEATURE_DIM
}

impl CalibrationProfile {
    /// Validate the matrix shape so a malformed file can't panic `predict`.
    /// Returns `None` (fail-safe → fall back to the magic-gain mapping) on any
    /// mismatch.
    fn validate(self) -> Option<Self> {
        if self.feature_dim != FEATURE_DIM {
            return None;
        }
        if self.coeffs.len() != FEATURE_DIM + 1 {
            return None;
        }
        if self.coeffs.iter().any(|row| row.len() != 2) {
            return None;
        }
        Some(self)
    }

    /// Map raw per-eye iris ratios to a screen point in `[0,1]` using the
    /// fitted coefficients. Mirrors the Python `profile_predict`.
    pub fn predict(&self, raw_x: f64, raw_y: f64) -> (f64, f64) {
        let features = build_features(raw_x, raw_y);
        // Leading 1.0 is the bias term.
        let mut x = 0.0;
        let mut y = 0.0;
        let inputs = std::iter::once(1.0).chain(features);
        for (input, row) in inputs.zip(self.coeffs.iter()) {
            x += input * row[0];
            y += input * row[1];
        }
        (clamp01(x), clamp01(y))
    }
}

/// Degree-2 polynomial feature vector — fixed column order shared with Python.
pub fn build_features(raw_x: f64, raw_y: f64) -> [f64; FEATURE_DIM] {
    [raw_x, raw_y, raw_x * raw_x, raw_y * raw_y, raw_x * raw_y]
}

fn clamp01(v: f64) -> f64 {
    if v.is_nan() { 0.0 } else { v.clamp(0.0, 1.0) }
}

/// Per-user profile path: `~/.eri/gaze_calibration.json`. `ERI_HOME` overrides
/// `HOME` so tests redirect without touching the real home dir (mirrors the
/// Python side's resolution order).
pub fn profile_path() -> Option<PathBuf> {
    let home = std::env::var("ERI_HOME")
        .ok()
        .or_else(|| std::env::var("HOME").ok())
        .or_else(|| std::env::var("USERPROFILE").ok())?;
    Some(Path::new(&home).join(".eri").join("gaze_calibration.json"))
}

/// Load + validate the profile, or `None` when absent/corrupt/mismatched.
/// Never errors — a missing profile is the normal first-run state and must
/// fall back to the legacy mapping.
pub fn load_profile(path: &Path) -> Option<CalibrationProfile> {
    let raw = std::fs::read_to_string(path).ok()?;
    let profile: CalibrationProfile = serde_json::from_str(&raw).ok()?;
    profile.validate()
}

/// Persist a profile atomically (write-temp-then-rename) so a crash mid-write
/// never leaves a half-written profile that would fail validation.
///
/// The Python sidecar writes the profile in production; this Rust writer is
/// the read/write pair's other half — exercised by the round-trip tests and
/// reserved for the planned Rust/Swift inference path (P3). Kept here so the
/// schema has a single canonical Rust serializer.
#[cfg_attr(not(test), allow(dead_code))]
pub fn save_profile(path: &Path, profile: &CalibrationProfile) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string(profile)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)
}

/// Standard 1€ filter (Casiez et al. 2012) for a scalar signal. Low speed →
/// heavy smoothing (kills jitter), high speed → light smoothing (kills lag).
#[derive(Debug, Clone)]
pub struct OneEuroFilter {
    min_cutoff: f64,
    beta: f64,
    d_cutoff: f64,
    x_prev: Option<f64>,
    dx_prev: f64,
    t_prev: Option<f64>,
}

impl OneEuroFilter {
    pub fn new(min_cutoff: f64, beta: f64) -> Self {
        Self {
            min_cutoff,
            beta,
            d_cutoff: 1.0,
            x_prev: None,
            dx_prev: 0.0,
            t_prev: None,
        }
    }

    fn alpha(cutoff: f64, dt: f64) -> f64 {
        let tau = 1.0 / (2.0 * std::f64::consts::PI * cutoff);
        1.0 / (1.0 + tau / dt)
    }

    /// Filter one sample taken at time `t` (seconds). The first sample is
    /// returned unchanged (no history to smooth against).
    pub fn filter(&mut self, x: f64, t: f64) -> f64 {
        let (Some(x_prev), Some(t_prev)) = (self.x_prev, self.t_prev) else {
            self.x_prev = Some(x);
            self.t_prev = Some(t);
            return x;
        };
        let dt = if t - t_prev <= 0.0 { 1e-3 } else { t - t_prev };
        self.t_prev = Some(t);
        let dx = (x - x_prev) / dt;
        let a_d = Self::alpha(self.d_cutoff, dt);
        let dx_hat = a_d * dx + (1.0 - a_d) * self.dx_prev;
        self.dx_prev = dx_hat;
        let cutoff = self.min_cutoff + self.beta * dx_hat.abs();
        let a = Self::alpha(cutoff, dt);
        let x_hat = a * x + (1.0 - a) * x_prev;
        self.x_prev = Some(x_hat);
        x_hat
    }
}

#[cfg(test)]
// Index-based loops are the clearest expression of the Gauss-Jordan /
// matrix-multiply math in the test fitter; iterator rewrites obscure it.
#[allow(clippy::needless_range_loop)]
mod tests {
    use super::*;

    /// Iris ratios (the inverse of a known affine-ish screen map) that look at
    /// a given target — the synthetic ground truth shared with the Python
    /// self-check (`sx = 0.5 - (rx-0.5)*3.0`, `sy = (ry-0.5)*2.8 + 0.5`).
    fn iris_for(tx: f64, ty: f64) -> (f64, f64) {
        (0.5 - (tx - 0.5) / 3.0, (ty - 0.5) / 2.8 + 0.5)
    }

    /// Fit a profile in Rust using the same closed-form ridge as Python so the
    /// predict path is exercised end-to-end without the sidecar.
    fn fit_ridge(
        features: &[[f64; FEATURE_DIM]],
        targets: &[(f64, f64)],
        lam: f64,
    ) -> Vec<Vec<f64>> {
        let n = features.len();
        let d = FEATURE_DIM + 1;
        // Design matrix with leading bias column.
        let x: Vec<Vec<f64>> = features
            .iter()
            .map(|f| {
                let mut row = vec![1.0];
                row.extend_from_slice(f);
                row
            })
            .collect();
        // XᵀX (d x d) with ridge on the diagonal (skip bias).
        let mut xtx = vec![vec![0.0; d]; d];
        for i in 0..d {
            for j in 0..d {
                let mut s = 0.0;
                for r in 0..n {
                    s += x[r][i] * x[r][j];
                }
                xtx[i][j] = s;
            }
        }
        for i in 1..d {
            xtx[i][i] += lam;
        }
        // XᵀY (d x 2).
        let mut xty = vec![vec![0.0; 2]; d];
        for i in 0..d {
            for r in 0..n {
                xty[i][0] += x[r][i] * targets[r].0;
                xty[i][1] += x[r][i] * targets[r].1;
            }
        }
        solve(xtx, xty)
    }

    /// Gauss-Jordan solve A X = B (A: d x d, B: d x m).
    fn solve(mut a: Vec<Vec<f64>>, mut b: Vec<Vec<f64>>) -> Vec<Vec<f64>> {
        let n = a.len();
        let m = b[0].len();
        for col in 0..n {
            let pivot = (col..n)
                .max_by(|&r1, &r2| a[r1][col].abs().partial_cmp(&a[r2][col].abs()).unwrap())
                .unwrap();
            a.swap(col, pivot);
            b.swap(col, pivot);
            let piv = a[col][col];
            for j in 0..n {
                a[col][j] /= piv;
            }
            for j in 0..m {
                b[col][j] /= piv;
            }
            for r in 0..n {
                if r == col {
                    continue;
                }
                let factor = a[r][col];
                if factor == 0.0 {
                    continue;
                }
                for j in 0..n {
                    a[r][j] -= factor * a[col][j];
                }
                for j in 0..m {
                    b[r][j] -= factor * b[col][j];
                }
            }
        }
        b
    }

    fn synthetic_profile() -> CalibrationProfile {
        let mut features = Vec::new();
        let mut targets = Vec::new();
        for &(tx, ty) in NINE_TARGETS.iter() {
            let (rx, ry) = iris_for(tx, ty);
            for k in 0..8 {
                // Tiny deterministic jitter so XᵀX is well-conditioned.
                let n = (k as f64 - 3.5) * 0.001;
                features.push(build_features(rx + n, ry - n));
                targets.push((tx, ty));
            }
        }
        let coeffs = fit_ridge(&features, &targets, 1e-4);
        CalibrationProfile {
            version: 1,
            targets: NINE_TARGETS.len() as u32,
            samples: features.len() as u32,
            feature_dim: FEATURE_DIM,
            coeffs,
        }
    }

    #[test]
    fn ridge_predicts_held_out_points_within_tolerance() {
        let profile = synthetic_profile();
        // Held-out targets not used verbatim during fitting.
        for &(tx, ty) in &[(0.3, 0.3), (0.7, 0.7), (0.5, 0.5), (0.2, 0.8)] {
            let (rx, ry) = iris_for(tx, ty);
            let (px, py) = profile.predict(rx, ry);
            assert!(
                (px - tx).abs() < 0.05 && (py - ty).abs() < 0.05,
                "target ({tx},{ty}) predicted ({px:.3},{py:.3})"
            );
        }
    }

    #[test]
    fn predict_is_clamped_and_nan_safe() {
        let profile = synthetic_profile();
        let (x, y) = profile.predict(f64::NAN, 0.5);
        assert!((0.0..=1.0).contains(&x));
        assert!((0.0..=1.0).contains(&y));
    }

    #[test]
    fn malformed_profile_fails_validation() {
        let bad = CalibrationProfile {
            version: 1,
            targets: 9,
            samples: 10,
            feature_dim: FEATURE_DIM,
            coeffs: vec![vec![0.0, 0.0]], // wrong row count
        };
        assert!(bad.validate().is_none());
    }

    #[test]
    fn profile_save_load_round_trips() {
        let dir = std::env::temp_dir().join(format!("eri_gaze_{}", std::process::id()));
        let path = dir.join("gaze_calibration.json");
        let profile = synthetic_profile();
        save_profile(&path, &profile).expect("save");
        let loaded = load_profile(&path).expect("load");
        // Coeffs survive the JSON round-trip to within f64 text-encoding noise
        // (serde may differ in the last ULP); shape + metadata are exact.
        assert_eq!(loaded.coeffs.len(), profile.coeffs.len());
        for (a, b) in loaded.coeffs.iter().zip(profile.coeffs.iter()) {
            assert!((a[0] - b[0]).abs() < 1e-9 && (a[1] - b[1]).abs() < 1e-9);
        }
        assert_eq!(loaded.targets, profile.targets);
        assert_eq!(loaded.samples, profile.samples);
        // Predictions agree after the round-trip (well within sub-pixel).
        let (rx, ry) = iris_for(0.5, 0.5);
        let (px0, py0) = profile.predict(rx, ry);
        let (px1, py1) = loaded.predict(rx, ry);
        assert!((px0 - px1).abs() < 1e-9 && (py0 - py1).abs() < 1e-9);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_profile_loads_as_none() {
        let path = std::env::temp_dir().join("eri_gaze_does_not_exist_xyz.json");
        let _ = std::fs::remove_file(&path);
        assert!(load_profile(&path).is_none());
    }

    #[test]
    fn one_euro_filter_reduces_jitter() {
        // Deterministic LCG so the test is reproducible.
        let mut state: u64 = 0x9E3779B9;
        let mut rng = || {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (state >> 33) as f64 / (1u64 << 31) as f64 // ~[0,1)
        };
        let mut filter = OneEuroFilter::new(0.5, 0.001);
        let base = 0.5;
        let mut noisy = Vec::new();
        let mut smoothed = Vec::new();
        for i in 0..120 {
            let n = base + (rng() - 0.5) * 0.2; // +/-0.1 jitter
            noisy.push(n);
            smoothed.push(filter.filter(n, i as f64 / 60.0));
        }
        let variance = |xs: &[f64]| {
            let mean = xs.iter().sum::<f64>() / xs.len() as f64;
            xs.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / xs.len() as f64
        };
        // Skip warm-up; the filter should cut variance by well over half.
        let noisy_var = variance(&noisy[20..]);
        let smoothed_var = variance(&smoothed[20..]);
        assert!(
            smoothed_var < noisy_var * 0.5,
            "noisy={noisy_var:.5} smoothed={smoothed_var:.5}"
        );
    }

    #[test]
    fn one_euro_first_sample_is_identity() {
        let mut filter = OneEuroFilter::new(1.0, 0.007);
        assert_eq!(filter.filter(0.42, 0.0), 0.42);
    }
}
