"""Amboy deid-gateway — the privacy boundary.

/ingest      de-identifies an uploaded report and writes ONLY token-only text +
             numeric facts to Postgres/pgvector + the deid MinIO bucket. NPI never
             leaves this service except as Vault-transit ciphertext in token_vault.
/detokenize  Keycloak-gated (npi-reveal), audited re-identification — app tier only.
/retrieve    similarity search over DE-IDENTIFIED chunks (for the agent).
"""
from __future__ import annotations

import io

from fastapi import Depends, FastAPI, File, Form, UploadFile
from pydantic import BaseModel

from app.common import config, db, deid, embeddings, objstore
from app.common.auth import require_npi_reveal
from app.common.tokenizer import Tokenizer

app = FastAPI(title="amboy-deid-gateway")
_tok = Tokenizer()  # vault backend by default


def _extract_text(filename: str, raw: bytes) -> str:
    """Best-effort text extraction for an uploaded document."""
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(raw))
        return "\n".join((p.extract_text() or "") for p in reader.pages)
    if name.endswith(".docx"):
        import docx
        d = docx.Document(io.BytesIO(raw))
        return "\n".join(p.text for p in d.paragraphs)
    return raw.decode("utf-8", "ignore")  # .txt / .md / fallback


def _chunk(text: str, size: int = 900, max_chunks: int = 200):
    """Paragraph-aware chunking; bounded so a huge upload can't run away."""
    chunks, cur = [], ""
    for para in (text or "").split("\n"):
        para = para.strip()
        if not para:
            continue
        if len(cur) + len(para) + 1 > size and cur:
            chunks.append(cur)
            cur = ""
        cur = f"{cur} {para}".strip()
        if len(chunks) >= max_chunks:
            break
    if cur and len(chunks) < max_chunks:
        chunks.append(cur)
    return chunks


def _unit(metric: str) -> str:
    if metric.endswith("_usd"):
        return "USD"
    if metric.endswith("_pct"):
        return "pct"
    return "count"


class IngestRequest(BaseModel):
    bucket: str = config.S3_BUCKET_RAW
    raw_key: str | None = None          # object in the raw bucket, OR
    report: dict | None = None          # inline report (UI convenience)
    actor: str = "system"


class DetokenizeRequest(BaseModel):
    token: str


class RetrieveRequest(BaseModel):
    query: str
    report_id: str | None = None
    k: int = 5


@app.get("/healthz")
def healthz():
    return {"ok": True, "role": "deid_gateway"}


@app.post("/ingest")
def ingest(req: IngestRequest):
    report = req.report or objstore.get_json(req.bucket, req.raw_key)
    meta = report["meta"]
    fy = int(meta["fiscal_year"])
    bank = meta["bank"]
    report_id = f"AMB-FY{fy}"

    n_tokens = {"count": 0}
    deid_report = {"meta": meta, "financials": report["financials"],
                   "sector_concentration_usd": report["sector_concentration_usd"],
                   "loan_appendix": []}

    with db.connect() as conn:
        cur = conn.cursor()

        def persist_token(token, etype, value):
            db.upsert_token(cur, token, etype, _tok.encrypt(value))
            n_tokens["count"] += 1

        # Portfolio + sector facts (NPI-free numbers).
        for metric, value in report["financials"].items():
            db.upsert_report_fact(cur, report_id, fy, bank, metric, float(value), _unit(metric))
        for sector, bal in report["sector_concentration_usd"].items():
            db.upsert_sector_fact(cur, report_id, fy, sector, float(bal))

        # Loan appendix — tokenize structured PII + de-identify prose notes.
        for loan in report["loan_appendix"]:
            btok = deid.deidentify_value("PERSON", loan["borrower_name"], _tok, persist_token)
            for field, etype in (("ssn", "US_SSN"), ("phone", "PHONE"),
                                 ("email", "EMAIL"), ("street_address", "ADDRESS")):
                deid.deidentify_value(etype, loan[field], _tok, persist_token)
            deid_notes = deid.deidentify_text(loan["notes"], _tok, persist_token)

            db.upsert_loan_fact(cur, loan["loan_id"], report_id, fy, btok,
                                loan["sector"], loan["risk_grade"],
                                float(loan["balance_usd"]), loan["status"])
            db.insert_chunk(cur, report_id, fy, "notes", deid_notes,
                            embeddings.to_pgvector(embeddings.embed(deid_notes)))

            deid_report["loan_appendix"].append({
                "loan_id": loan["loan_id"], "borrower_token": btok,
                "sector": loan["sector"], "risk_grade": loan["risk_grade"],
                "balance_usd": loan["balance_usd"], "status": loan["status"],
                "notes": deid_notes,
            })

        objstore.put_json(config.S3_BUCKET_DEID, f"{report_id}.json", deid_report)
        db.audit(cur, req.actor, "ingest", report_id,
                 {"loans": len(report["loan_appendix"]), "tokens": n_tokens["count"]})

    return {"ok": True, "report_id": report_id, "fiscal_year": fy,
            "loans": len(report["loan_appendix"]), "tokens_stored": n_tokens["count"]}


@app.post("/ingest_document")
async def ingest_document(
    file: UploadFile = File(...),
    comparison_id: str = Form(...),
    side: str = Form("A"),
    year: int = Form(0),
    actor: str = Form("ui"),
):
    """De-identify + index an uploaded PDF/DOCX/TXT/MD so it can be chat-compared.
    Text is tokenized BEFORE indexing — only token-only chunks reach pgvector."""
    raw = await file.read()
    text = _extract_text(file.filename, raw)
    report_id = f"{comparison_id}::{side}"
    n_tokens = {"count": 0}

    with db.connect() as conn:
        cur = conn.cursor()

        def persist_token(token, etype, value):
            db.upsert_token(cur, token, etype, _tok.encrypt(value))
            n_tokens["count"] += 1

        deid_text = deid.deidentify_text(text, _tok, persist_token)
        chunks = _chunk(deid_text)
        cur.execute("DELETE FROM amboy.chunks WHERE report_id=%s", (report_id,))  # idempotent re-ingest
        for ch in chunks:
            db.insert_chunk(cur, report_id, year or None, "document", ch,
                            embeddings.to_pgvector(embeddings.embed(ch)))
        db.audit(cur, actor, "ingest", report_id,
                 {"chunks": len(chunks), "tokens": n_tokens["count"],
                  "kind": (file.filename or "").split(".")[-1].lower()})

    return {"ok": True, "report_id": report_id, "comparison_id": comparison_id,
            "side": side, "chunks_indexed": len(chunks), "tokens_stored": n_tokens["count"]}


@app.post("/detokenize")
def detokenize(req: DetokenizeRequest, principal=Depends(require_npi_reveal)):
    actor, _roles = principal
    with db.connect() as conn:
        cur = conn.cursor()
        ciphertext = db.get_ciphertext(cur, req.token)
        if not ciphertext:
            db.audit(cur, actor, "detokenize", req.token, {"found": False}, "not_found")
            return {"token": req.token, "value": None, "found": False}
        value = _tok.decrypt(ciphertext)
        # AUDIT DETAIL IS NPI-FREE: we log the token, never the revealed value.
        db.audit(cur, actor, "detokenize", req.token, {"found": True}, "revealed")
    return {"token": req.token, "value": value, "found": True}


@app.post("/retrieve")
def retrieve(req: RetrieveRequest):
    qv = embeddings.to_pgvector(embeddings.embed(req.query))
    with db.connect() as conn:
        cur = conn.cursor()
        rows = db.retrieve_chunks(cur, qv, req.report_id, req.k)
        db.audit(cur, "agent", "retrieve", req.report_id or "*", {"k": req.k, "hits": len(rows)})
    return {"chunks": rows}
