/**
 * Local pass wallet: signed JWTs cached in SQLite so the QR pass screen
 * renders with airplane mode on (CLAUDE.md hard rule 2).
 */
import { getDb } from '@/offline/db';
import type { PassClaims } from '@/offline/verifier';

export interface StoredPass {
  jti: string;
  typ: PassClaims['typ'];
  token: string;
  claims: PassClaims;
}

export async function savePass(token: string, claims: PassClaims, nowMs: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO passes (jti, typ, token, claims_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(jti) DO UPDATE SET
       typ = excluded.typ, token = excluded.token,
       claims_json = excluded.claims_json, updated_at = excluded.updated_at`,
    [claims.jti, claims.typ, token, JSON.stringify(claims), nowMs],
  );
}

export async function listPasses(): Promise<StoredPass[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    jti: string;
    typ: string;
    token: string;
    claims_json: string;
  }>('SELECT jti, typ, token, claims_json FROM passes ORDER BY updated_at DESC');
  return rows.map((r) => ({
    jti: r.jti,
    typ: r.typ as PassClaims['typ'],
    token: r.token,
    claims: JSON.parse(r.claims_json) as PassClaims,
  }));
}

export async function getPass(jti: string): Promise<StoredPass | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{
    jti: string;
    typ: string;
    token: string;
    claims_json: string;
  }>('SELECT jti, typ, token, claims_json FROM passes WHERE jti = ?', [jti]);
  if (!r) return null;
  return {
    jti: r.jti,
    typ: r.typ as PassClaims['typ'],
    token: r.token,
    claims: JSON.parse(r.claims_json) as PassClaims,
  };
}
