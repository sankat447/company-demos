"""Train the Coverage-Forecast model (DR-08).

Regressor: [dept_id, day_of_week] → required_staff. The live coverage check compares
this against scheduled shifts from Aurora; the engineered gap (open shifts) is what
makes a day understaffed, not the model. Logs to MLflow when configured.

  python -m train_forecast          # writes artifacts/forecast/model.joblib + metrics.json
"""

from __future__ import annotations

import json
from pathlib import Path

import joblib
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split

from common import FORECAST_FEATURES, make_forecast_dataset, maybe_mlflow

OUT = Path(__file__).parent / "artifacts" / "forecast"


def train():
    X, y = make_forecast_dataset()
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=7)

    model = HistGradientBoostingRegressor(max_depth=3, learning_rate=0.15, max_iter=150)
    model.fit(Xtr, ytr)

    pred = model.predict(Xte)
    metrics = {
        "mae": round(float(mean_absolute_error(yte, pred)), 4),
        "r2": round(float(r2_score(yte, pred)), 4),
        "n_train": int(len(Xtr)),
        "n_test": int(len(Xte)),
        "features": FORECAST_FEATURES,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, OUT / "model.joblib")
    (OUT / "metrics.json").write_text(json.dumps(metrics, indent=2))

    mlflow = maybe_mlflow()
    if mlflow:
        mlflow.set_experiment("nychhc-forecast")
        with mlflow.start_run():
            mlflow.log_params({"model": "HistGBR", "max_depth": 3, "max_iter": 150})
            mlflow.log_metrics({"mae": metrics["mae"], "r2": metrics["r2"]})
            mlflow.sklearn.log_model(model, "model")

    print(json.dumps(metrics, indent=2))
    print(f"saved → {OUT/'model.joblib'}")
    return metrics


if __name__ == "__main__":
    train()
