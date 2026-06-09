"""Train the No-Show risk model (DR-06).

Regressor on a 0/1 no-show label → outputs P(no_show). Serves on KServe sklearn
runtime via a plain joblib artifact. Logs to MLflow when MLFLOW_TRACKING_URI is set.

  python -m train_noshow            # writes artifacts/noshow/model.joblib + metrics.json
"""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import train_test_split

from common import NOSHOW_FEATURES, make_noshow_dataset, maybe_mlflow

OUT = Path(__file__).parent / "artifacts" / "noshow"


def train():
    X, y = make_noshow_dataset()
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=7, stratify=y)

    model = HistGradientBoostingRegressor(max_depth=4, learning_rate=0.1, max_iter=200)
    model.fit(Xtr, ytr)

    pred = np.clip(model.predict(Xte), 0.0, 1.0)
    metrics = {
        "auc": round(float(roc_auc_score(yte, pred)), 4),
        "brier": round(float(brier_score_loss(yte, pred)), 4),
        "n_train": int(len(Xtr)),
        "n_test": int(len(Xte)),
        "features": NOSHOW_FEATURES,
        "positive_rate": round(float(y.mean()), 4),
    }

    OUT.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, OUT / "model.joblib")
    (OUT / "metrics.json").write_text(json.dumps(metrics, indent=2))

    mlflow = maybe_mlflow()
    if mlflow:
        mlflow.set_experiment("nychhc-noshow")
        with mlflow.start_run():
            mlflow.log_params({"model": "HistGBR", "max_depth": 4, "max_iter": 200})
            mlflow.log_metrics({"auc": metrics["auc"], "brier": metrics["brier"]})
            mlflow.sklearn.log_model(model, "model")

    print(json.dumps(metrics, indent=2))
    print(f"saved → {OUT/'model.joblib'}")
    return metrics


if __name__ == "__main__":
    train()
