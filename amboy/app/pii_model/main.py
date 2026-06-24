"""amboy-pii-model — locally hosted PII/NPI detection model (Piiranha / DeBERTa),
CPU token-classification, baked into the image. Exposes /detect (text -> spans).
The deid-gateway calls this for the human-in-the-loop detection step; nothing
here tokenizes or persists — it only labels spans."""
from __future__ import annotations

import os
from functools import lru_cache

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="amboy-pii-model")

MODEL = os.environ.get("AMBOY_PII_MODEL", "iiiorg/piiranha-v1-detect-personal-information")
SCORE_MIN = float(os.environ.get("AMBOY_PII_SCORE_MIN", "0.5"))
WIN = 1600          # chars per inference window (DeBERTa ~512 tokens)
OVERLAP = 200

# Piiranha label -> our canonical token type.
LABEL_MAP = {
    "GIVENNAME": "PERSON", "SURNAME": "PERSON", "MIDDLENAME": "PERSON",
    "SOCIALNUM": "US_SSN", "TAXNUM": "US_SSN",
    "TELEPHONENUM": "PHONE", "EMAIL": "EMAIL",
    "STREET": "ADDRESS", "BUILDINGNUM": "ADDRESS", "CITY": "ADDRESS",
    "ZIPCODE": "ADDRESS", "STATE": "ADDRESS",
    "ACCOUNTNUM": "ACCOUNT", "IDCARDNUM": "ACCOUNT", "DRIVERLICENSENUM": "ACCOUNT",
    "CREDITCARDNUMBER": "CREDIT_CARD", "DATEOFBIRTH": "DOB",
    "PASSWORD": "CREDENTIAL", "USERNAME": "CREDENTIAL",
}
TYPE_DESC = {
    "PERSON": "Person name", "US_SSN": "Social Security / tax number",
    "PHONE": "Telephone number", "EMAIL": "Email address",
    "ADDRESS": "Postal address", "ACCOUNT": "Account / ID number",
    "CREDIT_CARD": "Payment card number", "DOB": "Date of birth",
    "CREDENTIAL": "Credential", "ZIP": "ZIP code",
}


BASE_VERSION = os.environ.get("AMBOY_PII_BASE_VERSION", "piiranha-base-v1")


def _base_local():
    """Pull the base model from in-stack MinIO to a local dir (deploy-from-S3, no
    external traffic). Returns the local path, or None to fall back to the baked copy."""
    try:
        from app.common import config, objstore
        c = objstore.client()
        prefix = f"models/base/{BASE_VERSION}/"
        objs = c.list_objects_v2(Bucket=config.S3_BUCKET_DEID, Prefix=prefix).get("Contents", [])
        if not objs:
            return None
        local = os.path.join("/tmp/amboy-base", BASE_VERSION)
        if not (os.path.isdir(local) and os.listdir(local)):
            for o in objs:
                rel = o["Key"][len(prefix):]
                if not rel:
                    continue
                dst = os.path.join(local, rel)
                os.makedirs(os.path.dirname(dst) or local, exist_ok=True)
                c.download_file(config.S3_BUCKET_DEID, o["Key"], dst)
        return local
    except Exception:
        return None


@lru_cache(maxsize=1)
def _pipe():
    from transformers import pipeline  # lazy/heavy
    src = _base_local() or MODEL       # S3-first; baked HF id as fallback
    return pipeline("token-classification", model=src, tokenizer=src,
                    aggregation_strategy="simple", device=-1)


# ── Learned head (fine-tuned in the Model Training console) ──────────────────
# A small classifier over MiniLM features that adds org-specific NPI classes
# (e.g. ACCOUNT) the base model misses. Loaded from MinIO; reloaded after a
# training run's Provision step so /detect's behavior changes live (the
# before/after "InstructLab" experience).
HEAD_LABELS = ["O", "PERSON", "US_SSN", "PHONE", "EMAIL", "ADDRESS", "ACCOUNT"]
HEAD_MIN = float(os.environ.get("AMBOY_HEAD_SCORE_MIN", "0.6"))
_HEAD = {"model": None, "version": None}
_WORD_RE = __import__("re").compile(r"\S+")


def _load_head(key: str | None = None) -> bool:
    try:
        import io
        import torch
        import torch.nn as nn
        from app.common import config, objstore
        c = objstore.client()
        if not key:
            objs = c.list_objects_v2(Bucket=config.S3_BUCKET_DEID, Prefix="models/").get("Contents", [])
            if not objs:
                return False
            key = sorted(objs, key=lambda o: o["LastModified"])[-1]["Key"]
        data = c.get_object(Bucket=config.S3_BUCKET_DEID, Key=key)["Body"].read()
        head = nn.Sequential(nn.Linear(384, 128), nn.ReLU(), nn.Linear(128, len(HEAD_LABELS)))
        head.load_state_dict(torch.load(io.BytesIO(data), map_location="cpu"))
        head.eval()
        _HEAD["model"] = head
        _HEAD["version"] = key.split("/")[-1].replace(".pt", "")
        return True
    except Exception:
        return False


def _head_spans(text: str):
    if _HEAD["model"] is None:
        return []
    import torch
    from app.common import embeddings
    toks = [(m.group(0), m.start(), m.end()) for m in _WORD_RE.finditer(text)]
    if not toks:
        return []
    feats = torch.tensor(embeddings.embed_batch([t[0] for t in toks]))
    with torch.no_grad():
        probs = torch.softmax(_HEAD["model"](feats), dim=1)
        score, idx = probs.max(1)
    out = []
    for (w, s, e), sc, ix in zip(toks, score.tolist(), idx.tolist()):
        lbl = HEAD_LABELS[ix]
        if lbl != "O" and sc >= HEAD_MIN:
            out.append({"start": s, "end": e, "score": round(sc, 3),
                        "label": lbl, "type": lbl, "text": w, "source": "learned"})
    return out


@app.post("/reload")
def reload(body: dict | None = None):
    ok = _load_head((body or {}).get("key"))
    return {"ok": ok, "version": _HEAD["version"]}


@app.on_event("startup")
def _warm():
    try:
        _pipe()("warm up")
    except Exception:
        pass  # readiness still flips; first /detect will surface a real error
    _load_head()  # pick up the latest fine-tuned head, if any


class DetectReq(BaseModel):
    text: str


def _canon(label: str) -> str:
    return LABEL_MAP.get(label.upper(), label.upper())


@app.get("/healthz")
def healthz():
    return {"ok": True, "role": "pii_model", "model": MODEL}


@app.post("/detect")
def detect(req: DetectReq):
    text = req.text or ""
    pipe = _pipe()
    spans = []
    pos = 0
    while pos < len(text):
        window = text[pos:pos + WIN]
        for e in pipe(window):
            if float(e.get("score", 0)) < SCORE_MIN:
                continue
            start, end = pos + int(e["start"]), pos + int(e["end"])
            spans.append({"start": start, "end": end, "score": round(float(e["score"]), 3),
                          "label": str(e.get("entity_group", "PII")),
                          "type": _canon(str(e.get("entity_group", "PII"))),
                          "text": text[start:end]})
        if pos + WIN >= len(text):
            break
        pos += WIN - OVERLAP

    spans += _head_spans(text)   # learned head adds org-specific classes (e.g. ACCOUNT)

    # de-dup overlapping spans from the sliding windows (keep highest score)
    spans.sort(key=lambda s: (s["start"], -(s["end"] - s["start"]), -s["score"]))
    merged, last_end = [], -1
    for s in spans:
        if s["start"] >= last_end:
            s["description"] = TYPE_DESC.get(s["type"], s["type"].replace("_", " ").title())
            merged.append(s)
            last_end = s["end"]
    return {"model": MODEL, "spans": merged}
