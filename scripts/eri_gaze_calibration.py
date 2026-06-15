#!/usr/bin/env python3
"""Per-user gaze calibration: feature -> screen ridge regression + 1e filter.

WHY this module exists
----------------------
The MediaPipe sidecar (``eri_gaze_mediapipe.py``) historically mapped iris
landmarks to the screen with hard-coded "magic gains" (e.g. ``0.5 -
(raw_x-0.5)*3.2``). Those constants are a population-average guess: they are
wrong for every individual head shape, camera placement, and seating distance.

This module replaces the guess with a genuine *per-user* 9-point calibration:

1. For each of nine known screen targets the sidecar collects several gaze
   FEATURE samples (raw iris ratios + head-pose proxies — NOT the magic-mapped
   output).
2. We fit a closed-form **ridge regression** ``(XᵀX + λI)⁻¹ XᵀY`` mapping the
   feature vector to screen ``[0,1]`` for x and y independently.
3. The fitted coefficients persist to a per-user JSON profile. At inference,
   if a profile exists we evaluate the regressor; otherwise the caller keeps
   the legacy magic-gain mapping (fail-safe fallback).

It also provides the standard **one-euro filter** to stabilise the emitted
gaze stream (raw landmark estimates jitter frame-to-frame).

The math is intentionally pure-Python (small matrices, closed form) so it has
**zero hard dependencies** and can be unit-tested without a camera, numpy, or
MediaPipe. ``python3 eri_gaze_calibration.py`` runs a self-check.
"""

from __future__ import annotations

import json
import math
import os
from typing import Iterable, Sequence

# --- profile location ---------------------------------------------------------

PROFILE_VERSION = 1


def profile_path() -> str:
    """Per-user calibration profile path.

    Mirrors the Rust side (``~/.eri/gaze_calibration.json``). ``ERI_HOME``
    overrides ``HOME`` so tests can redirect without touching the real home.
    """
    home = os.environ.get("ERI_HOME") or os.environ.get("HOME") or os.environ.get(
        "USERPROFILE"
    )
    if not home:
        # Last resort: cwd. Never raise — calibration is best-effort.
        home = os.getcwd()
    return os.path.join(home, ".eri", "gaze_calibration.json")


# --- feature vector -----------------------------------------------------------
#
# We keep the feature builder in one place so the calibration capture and the
# inference path agree on column order. The bias term (1.0) is appended by the
# regressor itself, not here.


def build_features(raw_x: float, raw_y: float) -> list[float]:
    """Map per-eye iris ratios to a small polynomial feature vector.

    Degree-2 terms let the ridge fit mild lens/perspective curvature without
    overfitting nine points. Order is fixed and shared by fit + predict.
    """
    return [raw_x, raw_y, raw_x * raw_x, raw_y * raw_y, raw_x * raw_y]


FEATURE_DIM = 5


# --- closed-form ridge regression --------------------------------------------


def _mat_mul(a: Sequence[Sequence[float]], b: Sequence[Sequence[float]]) -> list[list[float]]:
    rows, inner, cols = len(a), len(b), len(b[0])
    out = [[0.0] * cols for _ in range(rows)]
    for i in range(rows):
        ai = a[i]
        for k in range(inner):
            aik = ai[k]
            if aik == 0.0:
                continue
            bk = b[k]
            oi = out[i]
            for j in range(cols):
                oi[j] += aik * bk[j]
    return out


def _transpose(a: Sequence[Sequence[float]]) -> list[list[float]]:
    return [list(col) for col in zip(*a)]


def _solve(a: list[list[float]], b: list[list[float]]) -> list[list[float]]:
    """Solve A X = B for square A via Gauss-Jordan with partial pivoting.

    A is (n x n), B is (n x m). Returns X (n x m). Raises ``ValueError`` if A
    is singular — the caller treats that as "calibration failed, keep fallback".
    """
    n = len(a)
    # Augment [A | B] and reduce in place on copies.
    aug = [list(a[i]) + list(b[i]) for i in range(n)]
    m = len(b[0])
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(aug[r][col]))
        if abs(aug[pivot][col]) < 1e-12:
            raise ValueError("singular calibration matrix")
        aug[col], aug[pivot] = aug[pivot], aug[col]
        piv = aug[col][col]
        inv = 1.0 / piv
        for j in range(col, n + m):
            aug[col][j] *= inv
        for r in range(n):
            if r == col:
                continue
            factor = aug[r][col]
            if factor == 0.0:
                continue
            for j in range(col, n + m):
                aug[r][j] -= factor * aug[col][j]
    return [row[n:] for row in aug]


def fit_ridge(
    features: Sequence[Sequence[float]],
    targets: Sequence[Sequence[float]],
    lam: float = 1e-2,
) -> list[list[float]]:
    """Fit ridge regression with an explicit bias column.

    ``features`` is N x D, ``targets`` is N x T (here T=2 for x and y). Returns
    coefficients of shape (D+1) x T. Solves ``(XᵀX + λI) W = Xᵀ Y`` where X has
    a leading bias column of ones. The bias term is NOT regularised.
    """
    if not features or not targets or len(features) != len(targets):
        raise ValueError("features/targets must be non-empty and equal length")
    # Design matrix with bias column first.
    x = [[1.0, *row] for row in features]
    n = len(x)
    d = len(x[0])
    xt = _transpose(x)
    xtx = _mat_mul(xt, x)
    # Ridge: add λ to the diagonal, skipping the bias term (index 0).
    for i in range(1, d):
        xtx[i][i] += lam
    xty = _mat_mul(xt, [list(t) for t in targets])
    return _solve(xtx, xty)


def predict(coeffs: Sequence[Sequence[float]], features: Sequence[float]) -> list[float]:
    """Evaluate fitted coefficients (D+1 x T) on one feature vector (D)."""
    x = [1.0, *features]
    t = len(coeffs[0])
    out = [0.0] * t
    for i, xi in enumerate(x):
        row = coeffs[i]
        for j in range(t):
            out[j] += xi * row[j]
    return out


# --- profile serialisation ----------------------------------------------------


def build_profile(
    samples_by_target: Iterable[tuple[tuple[float, float], Sequence[tuple[float, float]]]],
    lam: float = 1e-2,
) -> dict:
    """Fit a profile from grouped calibration captures.

    ``samples_by_target`` yields ``((target_x, target_y), [(raw_x, raw_y), ...])``.
    Each raw sample is expanded into the shared feature vector; the target is
    repeated per sample. Returns a JSON-serialisable profile dict.
    """
    features: list[list[float]] = []
    targets: list[list[float]] = []
    target_count = 0
    for (tx, ty), raws in samples_by_target:
        target_count += 1
        for (rx, ry) in raws:
            features.append(build_features(rx, ry))
            targets.append([tx, ty])
    coeffs = fit_ridge(features, targets, lam=lam)
    return {
        "version": PROFILE_VERSION,
        "lambda": lam,
        "feature_dim": FEATURE_DIM,
        "targets": target_count,
        "samples": len(features),
        "coeffs": coeffs,
    }


def save_profile(profile: dict, path: str | None = None) -> str:
    path = path or profile_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(profile, handle)
    os.replace(tmp, path)
    return path


def load_profile(path: str | None = None) -> dict | None:
    """Load a calibration profile, or ``None`` if absent/invalid.

    Never raises — a missing or corrupt profile must fall back to the legacy
    mapping, never crash the sidecar.
    """
    path = path or profile_path()
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or "coeffs" not in data:
        return None
    if data.get("feature_dim") != FEATURE_DIM:
        return None
    return data


def profile_predict(profile: dict, raw_x: float, raw_y: float) -> tuple[float, float]:
    """Map raw iris ratios to screen [0,1] via a loaded profile."""
    out = predict(profile["coeffs"], build_features(raw_x, raw_y))
    return (_clamp01(out[0]), _clamp01(out[1]))


def _clamp01(value: float) -> float:
    if math.isnan(value):
        return 0.0
    return max(0.0, min(1.0, value))


# --- one-euro filter ----------------------------------------------------------


class OneEuroFilter:
    """Standard 1€ filter (Casiez et al. 2012) for a scalar signal.

    Low-speed -> heavy smoothing (kills jitter); high-speed -> light smoothing
    (kills lag). ``min_cutoff`` sets the floor responsiveness, ``beta`` how
    aggressively the cutoff rises with speed.
    """

    def __init__(self, min_cutoff: float = 1.0, beta: float = 0.007, d_cutoff: float = 1.0):
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self._x_prev: float | None = None
        self._dx_prev = 0.0
        self._t_prev: float | None = None

    @staticmethod
    def _alpha(cutoff: float, dt: float) -> float:
        tau = 1.0 / (2.0 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)

    def filter(self, x: float, t: float) -> float:
        if self._x_prev is None or self._t_prev is None:
            self._x_prev = x
            self._t_prev = t
            return x
        dt = t - self._t_prev
        if dt <= 0.0:
            dt = 1e-3
        self._t_prev = t
        dx = (x - self._x_prev) / dt
        a_d = self._alpha(self.d_cutoff, dt)
        dx_hat = a_d * dx + (1.0 - a_d) * self._dx_prev
        self._dx_prev = dx_hat
        cutoff = self.min_cutoff + self.beta * abs(dx_hat)
        a = self._alpha(cutoff, dt)
        x_hat = a * x + (1.0 - a) * self._x_prev
        self._x_prev = x_hat
        return x_hat


class GazeSmoother:
    """Pairs two 1€ filters for the (x, y) gaze point."""

    def __init__(self, min_cutoff: float = 1.0, beta: float = 0.007):
        self._fx = OneEuroFilter(min_cutoff=min_cutoff, beta=beta)
        self._fy = OneEuroFilter(min_cutoff=min_cutoff, beta=beta)

    def smooth(self, x: float, y: float, t: float) -> tuple[float, float]:
        return (self._fx.filter(x, t), self._fy.filter(y, t))


# --- nine calibration targets -------------------------------------------------

NINE_TARGETS: tuple[tuple[float, float], ...] = (
    (0.1, 0.1), (0.5, 0.1), (0.9, 0.1),
    (0.1, 0.5), (0.5, 0.5), (0.9, 0.5),
    (0.1, 0.9), (0.5, 0.9), (0.9, 0.9),
)


# --- self-check ---------------------------------------------------------------


def _self_check() -> int:
    """Camera-free unit checks. Returns process exit code (0 = pass)."""
    failures: list[str] = []

    # 1. Ridge recovers a known affine map within tolerance on held-out points.
    #    Ground truth: screen = A·[rx, ry] + b. Synthesise iris ratios in the
    #    realistic 0.3..0.7 band and map them through a known transform.
    def truth(rx: float, ry: float) -> tuple[float, float]:
        sx = _clamp01(0.5 - (rx - 0.5) * 3.0)
        sy = _clamp01((ry - 0.5) * 2.8 + 0.5)
        return sx, sy

    rng_state = 12345

    def rng() -> float:
        nonlocal rng_state
        rng_state = (1103515245 * rng_state + 12345) & 0x7FFFFFFF
        return rng_state / 0x7FFFFFFF

    groups = []
    for (tx, ty) in NINE_TARGETS:
        raws = []
        for _ in range(8):
            # Invert the truth map approximately to find iris ratios that look
            # at this target, then add small noise (camera jitter).
            rx = 0.5 - (tx - 0.5) / 3.0 + (rng() - 0.5) * 0.01
            ry = (ty - 0.5) / 2.8 + 0.5 + (rng() - 0.5) * 0.01
            raws.append((rx, ry))
        groups.append(((tx, ty), raws))

    profile = build_profile(groups, lam=1e-4)

    # Held-out: predict at fresh iris ratios for the centre + a corner.
    for (tx, ty) in [(0.3, 0.3), (0.7, 0.7), (0.5, 0.5)]:
        rx = 0.5 - (tx - 0.5) / 3.0
        ry = (ty - 0.5) / 2.8 + 0.5
        px, py = profile_predict(profile, rx, ry)
        if abs(px - tx) > 0.05 or abs(py - ty) > 0.05:
            failures.append(
                f"ridge held-out off: target=({tx},{ty}) pred=({px:.3f},{py:.3f})"
            )

    # 2. Profile save/load round-trips.
    tmp = os.path.join(os.environ.get("TMPDIR", "/tmp"), "eri_gaze_selfcheck.json")
    save_profile(profile, tmp)
    reloaded = load_profile(tmp)
    if reloaded is None or reloaded["coeffs"] != profile["coeffs"]:
        failures.append("profile save/load did not round-trip")
    os.remove(tmp)

    # 3. Missing profile -> None (fallback path intact).
    if load_profile(os.path.join(tmp, "does", "not", "exist.json")) is not None:
        failures.append("missing profile should load as None")

    # 4. 1€ filter reduces jitter on a noisy constant-ish signal.
    smoother = GazeSmoother(min_cutoff=0.5, beta=0.001)
    noisy = []
    smoothed = []
    base = 0.5
    for i in range(120):
        n = base + (rng() - 0.5) * 0.2  # +/-0.1 jitter around base
        noisy.append(n)
        sx, _ = smoother.smooth(n, 0.5, i / 60.0)
        smoothed.append(sx)

    def variance(xs: list[float]) -> float:
        mean = sum(xs) / len(xs)
        return sum((x - mean) ** 2 for x in xs) / len(xs)

    # Compare variance over the settled tail (skip filter warm-up).
    noisy_var = variance(noisy[20:])
    smoothed_var = variance(smoothed[20:])
    if smoothed_var >= noisy_var * 0.5:
        failures.append(
            f"1e filter did not halve jitter: noisy={noisy_var:.5f} "
            f"smoothed={smoothed_var:.5f}"
        )

    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        return 1
    print("eri_gaze_calibration self-check OK "
          f"(ridge+save/load+fallback+1euro): {len(NINE_TARGETS)} targets")
    return 0


if __name__ == "__main__":
    raise SystemExit(_self_check())
