"""Offline checks: data gen shapes, models train and predict sanely."""

from __future__ import annotations

import numpy as np

from common import (FORECAST_FEATURES, NOSHOW_FEATURES, make_forecast_dataset,
                    make_noshow_dataset)


def test_noshow_dataset_shape_and_signal():
    X, y = make_noshow_dataset(2000)
    assert X.shape == (2000, len(NOSHOW_FEATURES))
    assert set(np.unique(y)) <= {0, 1}
    # Higher prior no-shows should correlate with the label (real signal).
    prior = X[:, 1]
    assert y[prior >= 3].mean() > y[prior == 0].mean()


def test_forecast_dataset_shape():
    X, y = make_forecast_dataset(weeks=4)
    assert X.shape[1] == len(FORECAST_FEATURES)
    assert (y > 0).all()


def test_noshow_trains_and_predicts_in_range():
    from train_noshow import train

    m = train()
    assert 0.6 <= m["auc"] <= 1.0  # learns something


def test_forecast_trains_with_low_error():
    from train_forecast import train

    m = train()
    # Target is weekday demand in provider-minutes (~3000-6800); MAE well under the
    # weekday spread, strong fit.
    assert m["mae"] < 400 and m["r2"] > 0.5
