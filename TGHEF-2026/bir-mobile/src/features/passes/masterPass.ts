/**
 * The master ticket (Phase 1): one per-user ES256 pass fetched from
 * GET /pass/master and cached locally so the QR shows offline. Minimal identity
 * (name + age-band + Pass ID) is inside the signed token; the coordinator's
 * scanner verifies it against the pinned JWKS — the same offline path as every
 * other pass. Returns a typed 'profile-incomplete' signal (HTTP 428) so the UI
 * can send the visitor to complete their DOB/consent first.
 */
import { fetchAuthSession } from 'aws-amplify/auth';

import { restUrl } from '@/config/stack';
import type { KvStore } from '@/offline/jwks';

export interface MasterPass {
  token: string;
  jti: string;
  name: string;
  ageBand: string;
  passId: string;
}

export class ProfileIncompleteError extends Error {
  constructor() {
    super('profile-incomplete');
    this.name = 'ProfileIncompleteError';
  }
}

const CACHE_KEY = 'passes.master.v1';

/** Fetch (and cache) the master pass. Throws ProfileIncompleteError on 428. */
export async function fetchMasterPass(kv: KvStore): Promise<MasterPass> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new Error('not authenticated');
  const res = await fetch(restUrl('/pass/master'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 428) throw new ProfileIncompleteError();
  if (!res.ok) throw new Error(`master pass failed: ${res.status}`);
  const pass = (await res.json()) as MasterPass;
  try {
    await kv.set(CACHE_KEY, JSON.stringify(pass));
  } catch {
    /* offline cache is best-effort */
  }
  return pass;
}

/** The last-known master pass, for offline display. */
export async function getCachedMasterPass(kv: KvStore): Promise<MasterPass | null> {
  try {
    const raw = await kv.get(CACHE_KEY);
    return raw ? (JSON.parse(raw) as MasterPass) : null;
  } catch {
    return null;
  }
}
