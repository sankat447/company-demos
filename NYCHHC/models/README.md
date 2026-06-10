# Predictive models — No-Show (DR-06) + Coverage Forecast (DR-08)

Real lightweight sklearn models trained on synthetic data, logged to MLflow, served
on **CPU KServe** (no GPU). The agent's `no_show_risk` / `coverage_forecast` tools
call these; if a model is down the backend falls back to the rules model (D5).

> ⚠️ FOR DEMONSTRATION ONLY — SYNTHETIC DATA.

## Models (plain sklearn regressors → KServe sklearn runtime, protocol v1)

| Model | Features (order = contract) | Output | Metric (local) |
|-------|------------------------------|--------|----------------|
| **noshow** | `[lead_time_days, prior_noshows, age_band_ord, dept_id]` | P(no_show) | AUC ≈ 0.79 |
| **forecast** | `[dept_id, day_of_week]` | required_staff | R² ≈ 0.96, MAE ≈ 0.18 |

Feature schemas live in `common.py` and MUST match the backend's
`tools/providers/live.py` (`LiveModels`), which fetches features from Aurora and
POSTs vectors — a KServe model can't resolve `appt_id` itself.

## Train + publish

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest -q                       # data + training sanity
./publish.sh                    # train + upload joblib → s3://ai-demo-data-lake/models/nychhc/
```

MLflow logging activates only when `MLFLOW_TRACKING_URI` is set (in-cluster:
the rhoai-mlflow server); locally it just writes `artifacts/*/metrics.json`.

## Serving

`gitops/manifests/60-*,61-*` deploy KServe `InferenceService`s (RawDeployment, CPU,
protocol v1) with `storageUri` pointing at the published S3 paths. The ConfigMap
wires the predictor URLs:
`http://{noshow,forecast}-predictor.nychhc-demo.svc.cluster.local/v1/models/{name}:predict`.

⚠️ **Version skew:** train with the same `scikit-learn` version the KServe sklearn
runtime ships, or the joblib may not unpickle server-side. Pin it in CI before a
real deploy.
