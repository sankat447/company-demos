"""Postgres helpers (reused platform pgvector DB, schema `amboy`).

Thin wrappers used by deid-gateway (writes facts/chunks/token_vault/audit) and
metrics-engine (reads facts). Every write path that touches user actions also
writes an NPI-free audit row.
"""
from __future__ import annotations

import json
from contextlib import contextmanager

from . import config


@contextmanager
def connect():
    import psycopg  # lazy import (offline tests don't need a DB)
    conn = psycopg.connect(config.pg_dsn())
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# ── writes (deid-gateway) ────────────────────────────────────────────────────
def upsert_report_fact(cur, report_id, fy, bank, metric, value, unit):
    cur.execute(
        """INSERT INTO amboy.report_facts (report_id,fiscal_year,bank,metric,value,unit)
           VALUES (%s,%s,%s,%s,%s,%s)
           ON CONFLICT (report_id,metric) DO UPDATE
             SET value=EXCLUDED.value, unit=EXCLUDED.unit""",
        (report_id, fy, bank, metric, value, unit))


def upsert_sector_fact(cur, report_id, fy, sector, balance):
    cur.execute(
        """INSERT INTO amboy.sector_facts (report_id,fiscal_year,sector,balance_usd)
           VALUES (%s,%s,%s,%s)
           ON CONFLICT (report_id,sector) DO UPDATE SET balance_usd=EXCLUDED.balance_usd""",
        (report_id, fy, sector, balance))


def upsert_loan_fact(cur, loan_id, report_id, fy, borrower_token, sector, grade, balance, status):
    cur.execute(
        """INSERT INTO amboy.loan_facts
             (loan_id,report_id,fiscal_year,borrower_token,sector,risk_grade,balance_usd,status)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (loan_id) DO UPDATE
             SET borrower_token=EXCLUDED.borrower_token, sector=EXCLUDED.sector,
                 risk_grade=EXCLUDED.risk_grade, balance_usd=EXCLUDED.balance_usd,
                 status=EXCLUDED.status""",
        (loan_id, report_id, fy, borrower_token, sector, grade, balance, status))


def upsert_token(cur, token, entity_type, ciphertext):
    cur.execute(
        """INSERT INTO amboy.token_vault (token,entity_type,ciphertext)
           VALUES (%s,%s,%s) ON CONFLICT (token) DO NOTHING""",
        (token, entity_type, ciphertext))


def insert_chunk(cur, report_id, fy, source, deid_text, embedding_literal):
    cur.execute(
        """INSERT INTO amboy.chunks (report_id,fiscal_year,source,deid_text,embedding)
           VALUES (%s,%s,%s,%s,%s::vector)""",
        (report_id, fy, source, deid_text, embedding_literal))


def get_ciphertext(cur, token):
    cur.execute("SELECT ciphertext FROM amboy.token_vault WHERE token=%s", (token,))
    row = cur.fetchone()
    return row[0] if row else None


# ── artifacts (Function 1) ───────────────────────────────────────────────────
def insert_artifact(cur, aid, name, filename, kind, entities, deid_chars, s3_key):
    cur.execute(
        """INSERT INTO amboy.artifacts (id,name,filename,kind,entities,deid_chars,s3_key)
           VALUES (%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, entities=EXCLUDED.entities,
             deid_chars=EXCLUDED.deid_chars, s3_key=EXCLUDED.s3_key""",
        (aid, name, filename, kind, entities, deid_chars, s3_key))


def list_artifacts(cur):
    cur.execute("SELECT id,name,filename,kind,entities,deid_chars,created_at "
                "FROM amboy.artifacts ORDER BY created_at DESC")
    return [{"id": i, "name": n, "filename": f, "kind": k, "entities": e,
             "deid_chars": d, "created_at": str(c)} for i, n, f, k, e, d, c in cur.fetchall()]


def get_artifact_key(cur, aid):
    cur.execute("SELECT s3_key FROM amboy.artifacts WHERE id=%s", (aid,))
    row = cur.fetchone()
    return row[0] if row else None


def delete_artifact(cur, aid):
    cur.execute("DELETE FROM amboy.artifacts WHERE id=%s", (aid,))


# ── comparisons registry + accepted metrics (Function 2) ─────────────────────
def register_comparison(cur, cid, label, a, b):
    cur.execute(
        """INSERT INTO amboy.comparisons (id,label,artifact_a,artifact_b)
           VALUES (%s,%s,%s,%s) ON CONFLICT (id) DO UPDATE
             SET label=EXCLUDED.label, artifact_a=EXCLUDED.artifact_a, artifact_b=EXCLUDED.artifact_b""",
        (cid, label, a, b))


def list_registered_comparisons(cur):
    cur.execute("SELECT id,label FROM amboy.comparisons ORDER BY created_at DESC")
    return [{"id": i, "label": l} for i, l in cur.fetchall()]


def upsert_comparison_metric(cur, cid, label, a, b, unit):
    cur.execute(
        """INSERT INTO amboy.comparison_metrics (comparison_id,label,a,b,unit)
           VALUES (%s,%s,%s,%s,%s) ON CONFLICT (comparison_id,label) DO UPDATE
             SET a=EXCLUDED.a, b=EXCLUDED.b, unit=EXCLUDED.unit""",
        (cid, label, a, b, unit))


def fetch_comparison_metrics(cur, cid):
    cur.execute("SELECT label,a,b,unit FROM amboy.comparison_metrics WHERE comparison_id=%s", (cid,))
    return [{"label": l, "a": a, "b": b, "unit": u} for l, a, b, u in cur.fetchall()]


def register_model_version(cur, version, name, accuracy, classes, s3_key):
    cur.execute(
        """INSERT INTO amboy.model_versions (version,name,accuracy,classes,s3_key)
           VALUES (%s,%s,%s,%s,%s) ON CONFLICT (version) DO UPDATE
             SET accuracy=EXCLUDED.accuracy, classes=EXCLUDED.classes, s3_key=EXCLUDED.s3_key""",
        (version, name, accuracy, classes, s3_key))


def list_model_versions(cur):
    cur.execute("SELECT version,name,accuracy,classes,created_at FROM amboy.model_versions "
                "ORDER BY created_at DESC")
    return [{"version": v, "name": n, "accuracy": a, "classes": c, "created_at": str(t)}
            for v, n, a, c, t in cur.fetchall()]


def get_model_s3_key(cur, version):
    cur.execute("SELECT s3_key FROM amboy.model_versions WHERE version=%s", (version,))
    r = cur.fetchone()
    return r[0] if r else None


def audit(cur, actor, action, resource=None, detail=None, outcome="ok"):
    """Append-only audit row. `detail` MUST be NPI-free (counts/ids only)."""
    cur.execute(
        """INSERT INTO amboy.audit_log (actor,action,resource,detail,outcome)
           VALUES (%s,%s,%s,%s,%s)""",
        (actor, action, resource, json.dumps(detail or {}), outcome))


# ── reads (metrics-engine + retrieval) ───────────────────────────────────────
def fetch_report_facts(cur, report_id):
    cur.execute("SELECT metric,value,unit FROM amboy.report_facts WHERE report_id=%s",
                (report_id,))
    return {m: {"value": v, "unit": u} for m, v, u in cur.fetchall()}


def fetch_sector_facts(cur, report_id):
    cur.execute("SELECT sector,balance_usd FROM amboy.sector_facts WHERE report_id=%s",
                (report_id,))
    return {s: b for s, b in cur.fetchall()}


def retrieve_chunks(cur, query_embedding_literal, report_id=None, k=5):
    if report_id:
        cur.execute(
            """SELECT report_id,fiscal_year,source,deid_text
               FROM amboy.chunks WHERE report_id=%s
               ORDER BY embedding <=> %s::vector LIMIT %s""",
            (report_id, query_embedding_literal, k))
    else:
        cur.execute(
            """SELECT report_id,fiscal_year,source,deid_text
               FROM amboy.chunks ORDER BY embedding <=> %s::vector LIMIT %s""",
            (query_embedding_literal, k))
    return [{"report_id": r, "fiscal_year": fy, "source": s, "deid_text": t}
            for r, fy, s, t in cur.fetchall()]
