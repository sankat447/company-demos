"""Shared model utilities — synthetic data, feature schema, MLflow helper.

FOR DEMONSTRATION ONLY — SYNTHETIC DATA. The feature schemas here are the contract
between training (this package) and serving-time feature assembly (the backend's
LiveModels, which fetches features from Aurora and POSTs vectors to KServe).

Models are plain sklearn **regressors** so KServe's sklearn runtime can serve them
with no custom pickled classes (a serving-env import trap):
  - no-show:  features → P(no_show) in ~[0,1]   (regressor on a 0/1 target)
  - forecast: features → required_staff (float)
"""

from __future__ import annotations

import numpy as np

# ── Feature schemas (ORDER IS THE CONTRACT) ──────────────────────────────────
# No-show: [lead_time_days, prior_noshows, age_band_ord, dept_id]
NOSHOW_FEATURES = ["lead_time_days", "prior_noshows", "age_band_ord", "dept_id"]
# Forecast: [dept_id, day_of_week]  (dow: Mon=0 .. Sun=6)
FORECAST_FEATURES = ["dept_id", "day_of_week"]

AGE_BANDS = {"0-17": 0, "18-39": 1, "40-64": 2, "65+": 3}

# Department rosters (drives the forecast target = normal full staffing).
DEPT_ROSTER = {1: 4, 2: 2, 3: 2}  # matches db/schema.sql seed


def _rng(seed: int = 1729) -> np.random.Generator:
    return np.random.default_rng(seed)


def make_noshow_dataset(n: int = 6000, seed: int = 1729):
    """Synthetic appointment features + a 0/1 no-show label from a latent logistic.

    The label has real signal (prior no-shows and long lead times raise risk) plus
    noise, so a model can learn something non-trivial.
    """
    rng = _rng(seed)
    lead = rng.integers(1, 30, n)
    prior = rng.integers(0, 5, n)
    age_ord = rng.integers(0, 4, n)
    dept = rng.integers(1, 4, n)
    # Latent risk: higher with prior no-shows + long lead; younger adults slightly higher.
    z = -2.3 + 0.85 * prior + 0.06 * lead + 0.15 * (age_ord == 1) - 0.05 * dept
    p = 1 / (1 + np.exp(-z))
    label = (rng.random(n) < p).astype(int)
    X = np.column_stack([lead, prior, age_ord, dept]).astype(float)
    return X, label


def make_forecast_dataset(weeks: int = 26, seed: int = 1729):
    """Per (dept, day_of_week) required-staff targets ~ the dept roster + small noise.

    The model learns roster-level required staffing; the coverage gap in the live
    path then comes from open shifts (projected < required), not from the model.
    """
    rng = _rng(seed)
    rows, targets = [], []
    for _ in range(weeks):
        for dept, roster in DEPT_ROSTER.items():
            for dow in range(7):
                # Weekdays need the full roster; weekends slightly less.
                base = roster if dow < 5 else max(1, roster - 1)
                noise = rng.normal(0, 0.25)
                rows.append([dept, dow])
                targets.append(base + noise)
    return np.array(rows, dtype=float), np.array(targets, dtype=float)


def maybe_mlflow():
    """Return the mlflow module if available AND a tracking URI is configured, else None.

    In-cluster: set MLFLOW_TRACKING_URI to the rhoai-mlflow server. Locally (no URI):
    training still runs and saves artifacts; it just skips MLflow logging.
    """
    import os

    if not os.environ.get("MLFLOW_TRACKING_URI"):
        return None
    try:
        import mlflow  # noqa
        return mlflow
    except Exception:
        return None
