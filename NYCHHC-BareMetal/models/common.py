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

# ── Feature schemas (ORDER IS THE CONTRACT — mirrors seed_data.encode_features) ─
# No-show: [appt_type_ord, day_of_week, time_of_day_ord, prior_noshows,
#           has_contact, provider_type_ord, visit_count]
NOSHOW_FEATURES = ["appt_type", "day_of_week", "time_of_day", "prior_noshows",
                   "has_contact", "provider_type", "visit_count"]
# Forecast (ASK4 demand): [day_of_week] → expected clinic demand in provider-minutes.
# Served by KServe (nychhc-forecast); the backend's capacity/load view calls it for the
# demand side (headcount ≠ capacity). Weekday mix mirrors the transcript: Tuesday heaviest
# (New-OB-heavy, longer visits), Friday lightest (half-day).
FORECAST_FEATURES = ["day_of_week"]
WEEKDAY_DEMAND_MIN = {0: 4100, 1: 6800, 2: 5200, 3: 4800, 4: 3000}  # Mon..Fri provider-minutes

# Brief patterns (transcript-sourced). Keep in sync with backend seed_data.py.
APPT_TYPES = {"New OB": 0.28, "Follow-up": 0.12, "High Risk": 0.08, "GYN Consult": 0.18, "Walk-in": 0.45}
APPT_TYPE_ORD = {t: i for i, t in enumerate(APPT_TYPES)}
PROVIDER_TYPE_ORD = {"MD": 0, "Midwife": 1, "PA": 2, "Walk-in": 3}
DAY_TIME_MULT = {
    (0, 0): 0.70, (0, 1): 0.85, (1, 0): 1.10, (1, 1): 1.80, (2, 0): 0.90,
    (2, 1): 1.00, (3, 0): 0.95, (3, 1): 1.05, (4, 0): 1.10, (4, 1): 1.30,
}
DEPT_ROSTER = {1: 4, 2: 2, 3: 2}  # retained for the (unused) forecast model


def _rng(seed: int = 1729) -> np.random.Generator:
    return np.random.default_rng(seed)


def make_noshow_dataset(n: int = 6000, seed: int = 42):
    """Synthetic no-show corpus on the BRIEF's features (transcript patterns):
    appt-type base rates × day/time multipliers × prior-no-show × no-contact, with
    Tuesday-PM the high-cancel slot. Returns (X[7 cols], 0/1 label)."""
    rng = _rng(seed)
    atypes = list(APPT_TYPES)
    rows, labels = [], []
    for _ in range(n):
        atype = atypes[rng.integers(0, len(atypes))]
        dow = int(rng.integers(0, 5))            # Mon..Fri
        tod = int(rng.integers(0, 2))            # AM/PM
        prior = int(rng.poisson(0.9))
        has_contact = 1 if rng.random() > 0.15 else 0
        ptype = ("Walk-in" if atype == "Walk-in"
                 else "MD" if atype == "High Risk"
                 else ["MD", "Midwife", "PA"][int(rng.integers(0, 3))])
        visit = int(rng.integers(1, 24))
        base = APPT_TYPES[atype]
        mult = DAY_TIME_MULT.get((dow, tod), 1.0)
        if prior >= 3:
            mult *= 1.60
        elif prior >= 1:
            mult *= 1.20
        if not has_contact:
            mult *= 1.30
        p = min(0.92, base * mult)
        rows.append([APPT_TYPE_ORD[atype], dow, tod, prior, has_contact,
                     PROVIDER_TYPE_ORD[ptype], visit])
        labels.append(1 if rng.random() < p else 0)
    return np.array(rows, dtype=float), np.array(labels, dtype=int)


def make_forecast_dataset(weeks: int = 60, seed: int = 1729):
    """Per-weekday clinic demand (provider-minutes) ~ the weekday profile + small noise.

    The model learns demand-by-weekday; the backend's capacity view (ASK4) POSTs a
    weekday to KServe to get expected demand-minutes, then compares against staffed
    minutes — so headcount-balanced days can still be capacity-imbalanced. Returns
    (X[1 col: day_of_week], demand_minutes).
    """
    rng = _rng(seed)
    rows, targets = [], []
    for _ in range(weeks):
        for dow, base in WEEKDAY_DEMAND_MIN.items():
            rows.append([dow])
            targets.append(max(0.0, base + rng.normal(0, 220)))
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
