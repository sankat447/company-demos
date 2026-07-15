"""KFP v2 pipeline: fine-tune the NPI-tagger head and provision it on KServe.

DAG: ingest -> featurize -> train -> evaluate (logs held_out_accuracy) -> register
(MinIO + amboy.model_versions) -> deploy (scale KServe + reload + active marker +
display-name) -> smoke. Components run on the amboy image; the deploy step runs as
the `amboy` ServiceAccount (which holds the amboy-isvc-scaler Role)."""
import os

from kfp import dsl
from kfp.dsl import Dataset, Input, Metrics, Model, Output

IMAGE = os.environ.get(
    "AMBOY_IMAGE", "image-registry.openshift-image-registry.svc:5000/iis-ai-ai/amboy:latest")
# Task pods run as the DSP runner SA (pipeline-runner-amboy-dsp); it is granted the
# amboy-isvc-scaler Role so the deploy step can patch the KServe InferenceService.


@dsl.component(base_image=IMAGE)
def ingest_corpus(corpus: Output[Dataset], n_per_class: int = 120):
    """Build the synthetic NPI corpus (incl. ACCOUNT across years)."""
    import json
    import sys
    sys.path.insert(0, "/app")
    from app.compare_agent.training import _corpus
    with open(corpus.path, "w") as f:
        json.dump(_corpus(n_per_class), f)


@dsl.component(base_image=IMAGE)
def featurize(corpus: Input[Dataset], features: Output[Dataset]):
    """Embed each token with the baked MiniLM encoder -> 384-d features."""
    import json
    import sys
    import numpy as np
    sys.path.insert(0, "/app")
    from app.common import embeddings
    LABELS = ["O", "PERSON", "US_SSN", "PHONE", "EMAIL", "ADDRESS", "ACCOUNT"]
    rows = json.load(open(corpus.path))
    X = np.asarray(embeddings.embed_batch([r[0] for r in rows]), dtype="float32")
    y = np.asarray([LABELS.index(r[1]) for r in rows], dtype="int64")
    with open(features.path, "wb") as f:
        np.savez(f, X=X, y=y)


@dsl.component(base_image=IMAGE)
def train_head(features: Input[Dataset], model: Output[Model], epochs: int = 200):
    """Fine-tune the small classifier head over MiniLM features (CPU)."""
    import numpy as np
    import torch
    import torch.nn as nn
    d = np.load(features.path)
    X, y = torch.tensor(d["X"]), torch.tensor(d["y"])
    cut = int(len(y) * 0.8)
    torch.manual_seed(0)
    head = nn.Sequential(nn.Linear(384, 128), nn.ReLU(), nn.Linear(128, 7))
    opt = torch.optim.Adam(head.parameters(), lr=1e-3)
    lossf = nn.CrossEntropyLoss()
    for _ in range(epochs):
        opt.zero_grad()
        loss = lossf(head(X[:cut]), y[:cut])
        loss.backward()
        opt.step()
    torch.save(head.state_dict(), model.path)


@dsl.component(base_image=IMAGE)
def evaluate(features: Input[Dataset], model: Input[Model], metrics: Output[Metrics]) -> float:
    """Held-out token accuracy -> logged as a KFP metric (shows in Experiments and runs)."""
    import numpy as np
    import torch
    import torch.nn as nn
    d = np.load(features.path)
    X, y = torch.tensor(d["X"]), torch.tensor(d["y"])
    cut = int(len(y) * 0.8)
    head = nn.Sequential(nn.Linear(384, 128), nn.ReLU(), nn.Linear(128, 7))
    head.load_state_dict(torch.load(model.path))
    head.eval()
    with torch.no_grad():
        acc = (head(X[cut:]).argmax(1) == y[cut:]).float().mean().item()
    acc = round(acc, 4)
    metrics.log_metric("held_out_accuracy", acc)
    return acc


@dsl.component(base_image=IMAGE)
def register(model: Input[Model], accuracy: float) -> str:
    """Push the fp32 head to MinIO + register a version row. Returns the version."""
    import sys
    sys.path.insert(0, "/app")
    from app.common import config, db, objstore
    ver = f"npi-tagger-{int(accuracy * 1000)}"
    key = f"models/{ver}.pt"
    with open(model.path, "rb") as f:
        objstore.client().put_object(Bucket=config.S3_BUCKET_DEID, Key=key, Body=f.read())
    with db.connect() as conn:
        db.register_model_version(conn.cursor(), ver, "npi-tagger", accuracy, 7, key)
    return ver


@dsl.component(base_image=IMAGE)
def deploy(version: str) -> str:
    """Stop -> re-provision the KServe model: scale 0->1, reload the new head, set the
    active marker + OpenShift AI display-name."""
    import sys
    import time
    sys.path.insert(0, "/app")
    import httpx
    from app.common import config
    from app.compare_agent import training as T
    key = f"models/{version}.pt"
    T._scale_inference_service(0)
    time.sleep(3)
    T._scale_inference_service(1)
    for _ in range(60):
        try:
            if httpx.get(f"{config.PII_MODEL_URL}/healthz", timeout=5).status_code == 200:
                break
        except Exception:
            pass
        time.sleep(3)
    httpx.post(f"{config.PII_MODEL_URL}/reload", json={"key": key}, timeout=30)
    T._write_active(version)
    T._set_display_name(f"Amboy PII/NPI Detector - {version} (NPI fine-tuned , pipeline)")
    return version


@dsl.component(base_image=IMAGE)
def smoke(version: str) -> str:
    """Confirm the served model answers /detect after provisioning."""
    import sys
    sys.path.insert(0, "/app")
    import httpx
    from app.common import config
    d = httpx.post(f"{config.PII_MODEL_URL}/detect",
                   json={"text": "Loan AMB-2025-100024 for Jane Doe; SSN 900-12-3456"},
                   timeout=30).json()
    return ",".join(sorted({s["type"] for s in d.get("spans", [])}))


@dsl.pipeline(name="amboy-npi-tagger",
              description="Fine-tune the Amboy NPI-tagger head and provision it on OpenShift AI (KServe).")
def npi_tagger(epochs: int = 200, n_per_class: int = 120):
    c = ingest_corpus(n_per_class=n_per_class)
    f = featurize(corpus=c.outputs["corpus"])
    t = train_head(features=f.outputs["features"], epochs=epochs)
    e = evaluate(features=f.outputs["features"], model=t.outputs["model"])
    # evaluate has both a return value and a Metrics artifact -> reference the return
    # by its default name "Output" (a bare .output is ambiguous with multiple outputs).
    r = register(model=t.outputs["model"], accuracy=e.outputs["Output"])
    d = deploy(version=r.output)
    s = smoke(version=d.output)
    # Disable KFP caching: register/deploy have real side effects (MinIO write, DB
    # insert, KServe re-provision) that must run every time — a cached "success"
    # would skip them and leave serving unchanged.
    for task in (c, f, t, e, r, d, s):
        task.set_caching_options(enable_caching=False)
