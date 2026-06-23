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


@lru_cache(maxsize=1)
def _pipe():
    from transformers import pipeline  # lazy/heavy
    return pipeline("token-classification", model=MODEL, tokenizer=MODEL,
                    aggregation_strategy="simple", device=-1)


@app.on_event("startup")
def _warm():
    try:
        _pipe()("warm up")
    except Exception:
        pass  # readiness still flips; first /detect will surface a real error


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

    # de-dup overlapping spans from the sliding windows (keep highest score)
    spans.sort(key=lambda s: (s["start"], -(s["end"] - s["start"]), -s["score"]))
    merged, last_end = [], -1
    for s in spans:
        if s["start"] >= last_end:
            s["description"] = TYPE_DESC.get(s["type"], s["type"].replace("_", " ").title())
            merged.append(s)
            last_end = s["end"]
    return {"model": MODEL, "spans": merged}
