"""Amboy deid-gateway — the privacy boundary.

/ingest      de-identifies an uploaded report and writes ONLY token-only text +
             numeric facts to Postgres/pgvector + the deid MinIO bucket. NPI never
             leaves this service except as Vault-transit ciphertext in token_vault.
/detokenize  Keycloak-gated (npi-reveal), audited re-identification — app tier only.
/retrieve    similarity search over DE-IDENTIFIED chunks (for the agent).
"""
from __future__ import annotations

import html as _html
import io
import json
import re
import time

import httpx
from fastapi import Depends, FastAPI, File, Form, UploadFile
from pydantic import BaseModel

from app.common import config, db, deid, embeddings, objstore, pii_patterns
from app.common.auth import require_npi_reveal
from app.common.tokenizer import Tokenizer

app = FastAPI(title="amboy-deid-gateway")
_tok = Tokenizer()  # vault backend by default

_TYPE_DESC = {
    "PERSON": "Person name", "US_SSN": "Social Security / tax number",
    "PHONE": "Telephone number", "EMAIL": "Email address",
    "ADDRESS": "Postal address", "ACCOUNT": "Account / loan number",
    "CREDIT_CARD": "Payment card number", "DOB": "Date of birth",
    "CREDENTIAL": "Credential",
}


_MODEL_CHUNK = 2400      # chars per model call (DeBERTa CPU pass is the bottleneck)
_MODEL_OVERLAP = 240     # keep entities that straddle a chunk boundary

# Custom ACCOUNT rules: operator-supplied regexes (terminal `train account <regex>`)
# stored in MinIO. A whitespace/CSV token that FULL-matches any rule is flagged
# ACCOUNT — deterministic, 100% coverage, immediate (no model retrain).
_ACCT_KEY = "models/account_patterns.json"
_TOKEN_RE = re.compile(r"[^\s,;|\t]+")
_ACCT_CACHE = {"compiled": [], "ts": -1e9}


def _account_rules():
    """Compiled custom ACCOUNT regexes, refreshed from MinIO at most every 10s."""
    now = time.time()
    if now - _ACCT_CACHE["ts"] < 10:
        return _ACCT_CACHE["compiled"]
    try:
        data = objstore.client().get_object(Bucket=config.S3_BUCKET_DEID, Key=_ACCT_KEY)["Body"].read()
        compiled = []
        for r in json.loads(data):
            try:
                compiled.append(re.compile(r))
            except re.error:
                pass
        _ACCT_CACHE["compiled"] = compiled
    except Exception:
        pass                       # keep last-good on any error
    _ACCT_CACHE["ts"] = now
    return _ACCT_CACHE["compiled"]


def _account_rule_spans(text: str):
    rules = _account_rules()
    if not rules:
        return []
    out = []
    for m in _TOKEN_RE.finditer(text):
        tok = m.group(0)
        if any(p.fullmatch(tok) for p in rules):
            out.append({"start": m.start(), "end": m.end(), "type": "ACCOUNT",
                        "label": "ACCOUNT", "score": 1.0, "source": "rule"})
    return out


def _model_spans(text: str):
    """Call the hosted model over the text in overlapping chunks, concurrently, so a
    large document never trips the per-call timeout (which would silently drop ALL
    model spans — incl. the learned ACCOUNT — leaving only the regex floor)."""
    if len(text) <= _MODEL_CHUNK:
        pieces = [(0, text)]
    else:
        step = _MODEL_CHUNK - _MODEL_OVERLAP
        pieces = [(i, text[i:i + _MODEL_CHUNK]) for i in range(0, len(text), step)]

    def _call(op):
        off, piece = op
        try:
            r = httpx.post(f"{config.PII_MODEL_URL}/detect", json={"text": piece}, timeout=90.0)
            r.raise_for_status()
            return [{"start": off + s["start"], "end": off + s["end"], "type": s["type"],
                     "label": s.get("label", s["type"]), "score": s.get("score", 1.0),
                     "source": "model"} for s in r.json().get("spans", [])]
        except Exception:
            return []

    from concurrent.futures import ThreadPoolExecutor
    out = []
    with ThreadPoolExecutor(max_workers=min(8, len(pieces))) as ex:
        for spans in ex.map(_call, pieces):
            out += spans
    return out


def _detect_spans(text: str):
    """Union of the hosted PII model (Piiranha + learned head) and the deterministic
    regex floor. Returns merged spans — NO tokenization."""
    text = text or ""
    raw = list(_model_spans(text))
    raw += _account_rule_spans(text)                   # operator ACCOUNT regex rules
    for label, rx in pii_patterns.DETECTORS.items():   # deterministic floor
        et = deid._LABEL_MAP.get(label, label)
        for m in rx.finditer(text):
            raw.append({"start": m.start(), "end": m.end(), "type": et,
                        "label": label, "score": 1.0, "source": "rule"})
    # merge overlaps: earliest start, then longest
    raw.sort(key=lambda s: (s["start"], -(s["end"] - s["start"]), -s["score"]))
    out, last_end, i = [], -1, 0
    for s in raw:
        if s["start"] >= last_end:
            s = {**s, "id": f"s{i}", "text": text[s["start"]:s["end"]],
                 "description": _TYPE_DESC.get(s["type"], s["type"].replace("_", " ").title())}
            out.append(s); last_end = s["end"]; i += 1
    return out


def _highlight_html(text: str, spans, filename: str) -> str:
    """Standalone, downloadable HTML: the document with every detected span
    highlighted + a legend + an entity table. (Reviewer's own document.)"""
    pieces, cur = [], 0
    for s in sorted(spans, key=lambda x: x["start"]):
        pieces.append(_html.escape(text[cur:s["start"]]))
        pieces.append(f'<mark class="t" title="{s["type"]} · {s["source"]} · {s["score"]}">'
                      f'{_html.escape(text[s["start"]:s["end"]])}'
                      f'<sub>{s["type"]}</sub></mark>')
        cur = s["end"]
    pieces.append(_html.escape(text[cur:]))
    rows = "".join(f"<tr><td>{_html.escape(s['text'][:60])}</td><td>{s['type']}</td>"
                   f"<td>{s['description']}</td><td>{s['source']}</td><td>{s['score']}</td></tr>"
                   for s in spans)
    return (f"<!doctype html><meta charset='utf-8'><title>PII review — {_html.escape(filename)}</title>"
            "<style>body{font-family:Inter,system-ui,sans-serif;margin:24px;color:#14193D}"
            "h1{font-size:18px;color:#1E2761}mark.t{background:#fdecea;color:#7a241b;border:1px solid #f3c4bd;"
            "border-radius:4px;padding:0 2px}mark.t sub{font-size:8px;color:#C0392B;margin-left:2px}"
            "pre{white-space:pre-wrap;background:#F7F8FB;border:1px solid #E2E8F0;border-radius:8px;padding:14px;font-family:ui-monospace,monospace;font-size:12px}"
            "table{border-collapse:collapse;margin-top:14px;font-size:12px}td,th{border:1px solid #E2E8F0;padding:5px 8px;text-align:left}"
            "th{background:#1E2761;color:#fff}.f{color:#5A6B86;font-size:11px;margin-top:18px}</style>"
            f"<h1>AMBOY BANK — PII/NPI review · {_html.escape(filename)}</h1>"
            f"<p style='font-size:12px;color:#5A6B86'>{len(spans)} entities detected (model + rules). "
            "Highlighted below; nothing is tokenized until you approve.</p>"
            f"<pre>{''.join(pieces)}</pre>"
            "<table><tr><th>Text</th><th>Type</th><th>Description</th><th>Source</th><th>Score</th></tr>"
            f"{rows}</table><p class='f'>AI solution by IIS · iistech.com — de-identification preview</p>")


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


class PurgeRequest(BaseModel):
    comparison_id: str


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


class TextReq(BaseModel):
    text: str


@app.post("/detect_text")
def detect_text(req: TextReq):
    """Lightweight text probe (model + rules) for the before/after training demo."""
    return {"spans": _detect_spans(req.text or "")}


@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    """Step 2: run the uploaded doc through the PII model + rules and return the
    detected spans + a downloadable highlighted document. Tokenizes NOTHING and
    persists NOTHING — this is the human-review preview."""
    raw = await file.read()
    text = _extract_text(file.filename, raw)
    spans = _detect_spans(text)
    return {"filename": file.filename, "text": text, "spans": spans,
            "highlighted_html": _highlight_html(text, spans, file.filename),
            "counts": {"total": len(spans)}}


class CommitReq(BaseModel):
    comparison_id: str
    side: str = "A"
    text: str
    accepted: list[dict] = []     # [{start,end,type}] the human approved
    year: int = 0
    actor: str = "ui"


@app.post("/commit")
def commit(req: CommitReq):
    """Step 3: tokenize ONLY the human-accepted spans, then chunk + embed + index.
    The raw text is used transiently and never persisted."""
    report_id = f"{req.comparison_id}::{req.side}"
    n_tokens = {"count": 0}
    text = req.text
    with db.connect() as conn:
        cur = conn.cursor()

        def persist(token, etype, value):
            db.upsert_token(cur, token, etype, _tok.encrypt(value))
            n_tokens["count"] += 1

        # replace accepted spans right-to-left so offsets stay valid
        for sp in sorted(req.accepted, key=lambda s: int(s["start"]), reverse=True):
            s, e = int(sp["start"]), int(sp["end"])
            token = deid.deidentify_value(sp.get("type", "PII"), text[s:e], _tok, persist)
            text = text[:s] + token + text[e:]

        chunks = _chunk(text)
        cur.execute("DELETE FROM amboy.chunks WHERE report_id=%s", (report_id,))
        vecs = embeddings.embed_batch(chunks)
        for ch, v in zip(chunks, vecs):
            db.insert_chunk(cur, report_id, req.year or None, "document", ch, embeddings.to_pgvector(v))
        db.audit(cur, req.actor, "ingest", report_id,
                 {"chunks": len(chunks), "tokens": n_tokens["count"],
                  "accepted_spans": len(req.accepted), "phase": "commit"})

    return {"ok": True, "report_id": report_id, "comparison_id": req.comparison_id,
            "side": req.side, "chunks_indexed": len(chunks), "tokens_stored": n_tokens["count"]}


import hashlib as _hashlib
import re as _re


def _slug(s: str) -> str:
    return _re.sub(r"[^a-z0-9]+", "-", (s or "artifact").lower()).strip("-")[:40] or "artifact"


def _token_highlight_html(deid_text: str, name: str, filename: str, n: int) -> str:
    """De-identified document with the [TYPE:hex] tokens highlighted — shows WHERE
    PII was (and its type) without ever exposing the raw value."""
    pieces, cur = [], 0
    for m in pii_patterns.TOKEN_RE.finditer(deid_text):
        pieces.append(_html.escape(deid_text[cur:m.start()]))
        pieces.append(f'<mark class="t">{_html.escape(m.group(0))}</mark>')
        cur = m.end()
    pieces.append(_html.escape(deid_text[cur:]))
    return (f"<!doctype html><meta charset='utf-8'><title>De-identified artifact — {_html.escape(name)}</title>"
            "<style>body{font-family:Inter,system-ui,sans-serif;margin:24px;color:#14193D}"
            "h1{font-size:18px;color:#1E2761}mark.t{background:#fdecea;color:#7a241b;border:1px solid #f3c4bd;"
            "border-radius:4px;padding:0 2px;font-family:ui-monospace,monospace;font-size:11px}"
            "pre{white-space:pre-wrap;background:#F7F8FB;border:1px solid #E2E8F0;border-radius:8px;padding:14px;font-size:12px}"
            ".f{color:#5A6B86;font-size:11px;margin-top:18px}</style>"
            f"<h1>AMBOY BANK — de-identified artifact · {_html.escape(name)}</h1>"
            f"<p style='font-size:12px;color:#5A6B86'>{_html.escape(filename)} · {n} entities tokenized · "
            "highlighted tokens mark where NPI was protected (raw values never stored).</p>"
            f"<pre>{''.join(pieces)}</pre>"
            "<p class='f'>AI solution by IIS · iistech.com — NPI-safe artifact</p>")


class ArtifactReq(BaseModel):
    name: str
    filename: str = ""
    kind: str = ""
    text: str                      # raw text from /detect
    accepted: list[dict] = []      # spans the human approved
    actor: str = "ui"


@app.post("/commit_artifact")
def commit_artifact(req: ArtifactReq):
    """Function 1 commit: tokenize accepted spans -> store a DE-IDENTIFIED,
    token-highlighted artifact in MinIO + registry. Does NOT index (that's
    Function 2). Raw text is transient."""
    text = req.text
    n_tokens = {"count": 0}
    with db.connect() as conn:
        cur = conn.cursor()

        def persist(token, etype, value):
            db.upsert_token(cur, token, etype, _tok.encrypt(value))
            n_tokens["count"] += 1

        for sp in sorted(req.accepted, key=lambda s: int(s["start"]), reverse=True):
            s, e = int(sp["start"]), int(sp["end"])
            token = deid.deidentify_value(sp.get("type", "PII"), text[s:e], _tok, persist)
            text = text[:s] + token + text[e:]
        deid_text = text
        aid = f"{_slug(req.name)}-{_hashlib.sha256((req.name + req.filename + deid_text).encode()).hexdigest()[:6]}"
        key = f"artifacts/{aid}.json"
        objstore.put_json(config.S3_BUCKET_DEID, key, {
            "id": aid, "name": req.name, "filename": req.filename, "kind": req.kind,
            "deid_text": deid_text, "entities": len(req.accepted),
            "highlighted_html": _token_highlight_html(deid_text, req.name, req.filename, len(req.accepted))})
        db.insert_artifact(cur, aid, req.name, req.filename, req.kind, len(req.accepted), len(deid_text), key)
        db.audit(cur, req.actor, "ingest", aid,
                 {"phase": "artifact", "entities": len(req.accepted), "tokens": n_tokens["count"]})
    return {"ok": True, "artifact_id": aid, "name": req.name,
            "entities": len(req.accepted), "deid_chars": len(deid_text)}


@app.get("/artifacts")
def artifacts():
    with db.connect() as conn:
        return {"artifacts": db.list_artifacts(conn.cursor())}


@app.get("/artifacts/{aid}")
def artifact(aid: str):
    with db.connect() as conn:
        key = db.get_artifact_key(conn.cursor(), aid)
    if not key:
        return {"error": "not found"}
    return objstore.get_json(config.S3_BUCKET_DEID, key)


@app.delete("/artifacts/{aid}")
def delete_artifact(aid: str):
    with db.connect() as conn:
        cur = conn.cursor()
        key = db.get_artifact_key(cur, aid)
        if key:
            objstore.delete(config.S3_BUCKET_DEID, key)
        db.delete_artifact(cur, aid)
        db.audit(cur, "ui", "delete", aid, {"phase": "artifact"})
    return {"ok": True, "deleted": aid}


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
        vecs = embeddings.embed_batch(chunks)
        for ch, v in zip(chunks, vecs):
            db.insert_chunk(cur, report_id, year or None, "document", ch, embeddings.to_pgvector(v))
        db.audit(cur, actor, "ingest", report_id,
                 {"chunks": len(chunks), "tokens": n_tokens["count"],
                  "kind": (file.filename or "").split(".")[-1].lower()})

    return {"ok": True, "report_id": report_id, "comparison_id": comparison_id,
            "side": side, "chunks_indexed": len(chunks), "tokens_stored": n_tokens["count"]}


@app.post("/purge_comparison")
def purge_comparison(req: PurgeRequest):
    """Delete a comparison's footprint to free space: index chunks + (seeded)
    facts in Postgres, and any stored raw/deid objects in MinIO. Audited (BUC-14)."""
    import re
    cid = req.comparison_id
    m = re.search(r"(\d{4})-(\d{4})$", cid)
    seeded_ids = [f"AMB-FY{m.group(1)}", f"AMB-FY{m.group(2)}"] if m else []

    with db.connect() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM amboy.chunks WHERE report_id = ANY(%s) OR report_id LIKE %s",
                    (seeded_ids, f"{cid}::%"))
        n_chunks = cur.rowcount
        n_facts = 0
        if seeded_ids:
            for tbl in ("report_facts", "sector_facts", "loan_facts"):
                cur.execute(f"DELETE FROM amboy.{tbl} WHERE report_id = ANY(%s)", (seeded_ids,))
                n_facts += cur.rowcount
        cur.execute("DELETE FROM amboy.comparison_metrics WHERE comparison_id=%s", (cid,))
        cur.execute("DELETE FROM amboy.comparisons WHERE id=%s", (cid,))
        db.audit(cur, "ui", "delete", cid, {"chunks_deleted": n_chunks, "facts_deleted": n_facts})

    # Remove stored objects (seeded reports keep raw + de-id objects; uploads keep none).
    n_objs = 0
    try:
        c = objstore.client()
        targets = []
        if seeded_ids:
            targets += [(config.S3_BUCKET_RAW, "report_2024.json"), (config.S3_BUCKET_RAW, "report_2025.json")]
            targets += [(config.S3_BUCKET_DEID, f"{rid}.json") for rid in seeded_ids]
        for bucket, key in targets:
            try:
                c.delete_object(Bucket=bucket, Key=key)
                n_objs += 1
            except Exception:
                pass
    except Exception:
        pass

    return {"ok": True, "comparison_id": cid, "chunks_deleted": n_chunks,
            "facts_deleted": n_facts, "objects_deleted": n_objs}


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
