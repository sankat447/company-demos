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
