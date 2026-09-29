/**
 * DEMO MODE — a clearly-labelled, backend-free session for evaluation builds
 * while the real stack contract points at example values.
 *
 * Entry: OTP 123456 after the real Cognito flow is unreachable. On first use
 * it seeds sample data end-to-end: a locally-generated P-256 keypair signs
 * demo passes and primes the JWKS cache, so the QR wallet and the offline
 * gate verifier run the REAL cryptographic path — nothing in the verifier or
 * outbox is mocked. Payments stay non-functional by design (CLAUDE.md: never
 * mock a payment). A visible banner marks the session as demo.
 */
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';

import { bytesToB64url, bytesToHex, hexToBytes, stringToUtf8 } from '@/offline/encoding';
import type { KvStore } from '@/offline/jwks';
import type { EcJwk, PassClaims } from '@/offline/verifier';

export const DEMO_OTP = '000000';

const SESSION_KEY = 'demo.session';
const SEEDED_KEY = 'demo.seeded';
const SIGNING_KEY = 'demo.signingKey';

/** Must match the contract's pinned issuer kid so the JWKS cache is accepted. */
const DEMO_KID = 'bir-2026-01';

export async function isDemoSession(kv: KvStore): Promise<boolean> {
  return (await kv.get(SESSION_KEY)) === '1';
}

export async function disableDemoSession(kv: KvStore): Promise<void> {
  await kv.set(SESSION_KEY, '0');
}

export interface DemoSeedDeps {
  kv: KvStore;
  primeJwks(kv: KvStore, keys: EcJwk[], nowMs: number): Promise<void>;
  savePass(token: string, claims: PassClaims, nowMs: number): Promise<void>;
  insertScheduleRow(row: DemoScheduleRow): Promise<void>;
}

export interface DemoScheduleRow {
  id: string;
  day: string;
  venue: string;
  startsAtSec: number;
  endsAtSec: number;
  titleEn: string;
  titleHi: string;
  dataJson: string | null;
}

export function signDemoPass(privKey: Uint8Array, claims: PassClaims): string {
  const enc = (obj: unknown) => bytesToB64url(stringToUtf8(JSON.stringify(obj)));
  const header = enc({ alg: 'ES256', kid: DEMO_KID });
  const payload = enc(claims);
  const sig = p256.sign(sha256(stringToUtf8(`${header}.${payload}`)), privKey).toCompactRawBytes();
  return `${header}.${payload}.${bytesToB64url(sig)}`;
}

function eveningSec(day: string, hour: number, minute = 0): number {
  return Math.floor(
    new Date(
      `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`,
    ).getTime() / 1000,
  );
}

/** CO-001 module B programme, one sample slice per evening. */
export function demoSchedule(): DemoScheduleRow[] {
  const votable = (category: string) => JSON.stringify({ votable: true, category });
  return [
    {
      id: 'd1-folk',
      day: '2026-11-21',
      venue: 'Chogan Ground',
      startsAtSec: eveningSec('2026-11-21', 18),
      endsAtSec: eveningSec('2026-11-21', 19),
      titleEn: 'Folk music of Kangra',
      titleHi: 'कांगड़ा का लोक संगीत',
      dataJson: votable('music'),
    },
    {
      id: 'd1-dance',
      day: '2026-11-21',
      venue: 'Chogan Ground',
      startsAtSec: eveningSec('2026-11-21', 19, 15),
      endsAtSec: eveningSec('2026-11-21', 20),
      titleEn: 'Traditional dance showcase',
      titleHi: 'पारंपरिक नृत्य प्रस्तुति',
      dataJson: votable('dance'),
    },
    {
      id: 'd1-story',
      day: '2026-11-21',
      venue: 'Heritage Stage',
      startsAtSec: eveningSec('2026-11-21', 20, 15),
      endsAtSec: eveningSec('2026-11-21', 21),
      titleEn: 'Storytelling under the stars',
      titleHi: 'तारों तले किस्सागोई',
      dataJson: null,
    },
    {
      id: 'd2-band',
      day: '2026-11-22',
      venue: 'Chogan Ground',
      startsAtSec: eveningSec('2026-11-22', 18),
      endsAtSec: eveningSec('2026-11-22', 19, 30),
      titleEn: 'Live band evening',
      titleHi: 'लाइव बैंड संध्या',
      dataJson: votable('band'),
    },
    {
      id: 'd2-comedy',
      day: '2026-11-22',
      venue: 'Heritage Stage',
      startsAtSec: eveningSec('2026-11-22', 19, 45),
      endsAtSec: eveningSec('2026-11-22', 20, 30),
      titleEn: 'Comedy & cultural night',
      titleHi: 'हास्य और सांस्कृतिक रात',
      dataJson: votable('comedy'),
    },
    {
      id: 'd2-heritage',
      day: '2026-11-22',
      venue: 'Heritage Stage',
      startsAtSec: eveningSec('2026-11-22', 20, 45),
      endsAtSec: eveningSec('2026-11-22', 21, 30),
      titleEn: 'Heritage showcase',
      titleHi: 'विरासत प्रदर्शनी',
      dataJson: null,
    },
    {
      id: 'd3-guest',
      day: '2026-11-23',
      venue: 'Chogan Ground',
      startsAtSec: eveningSec('2026-11-23', 18),
      endsAtSec: eveningSec('2026-11-23', 19),
      titleEn: 'Guest appearance',
      titleHi: 'विशेष अतिथि',
      dataJson: null,
    },
    {
      id: 'd3-awards',
      day: '2026-11-23',
      venue: 'Chogan Ground',
      startsAtSec: eveningSec('2026-11-23', 19, 30),
      endsAtSec: eveningSec('2026-11-23', 21),
      titleEn: 'Award ceremony — audience favourites',
      titleHi: 'पुरस्कार समारोह — दर्शकों के पसंदीदा',
      dataJson: null,
    },
  ];
}

/**
 * Idempotent: seeds once per install, then only flips the session flag.
 * Returns true when a fresh seed happened.
 */
export async function enableDemoSession(deps: DemoSeedDeps, nowMs: number): Promise<boolean> {
  await deps.kv.set(SESSION_KEY, '1');
  if ((await deps.kv.get(SEEDED_KEY)) === '1') return false;

  // Real ES256, generated on-device: the verifier path is exercised for real.
  const privKey = p256.utils.randomPrivateKey();
  const pubKey = p256.getPublicKey(privKey, false);
  const jwk: EcJwk = {
    kty: 'EC',
    crv: 'P-256',
    kid: DEMO_KID,
    x: bytesToB64url(pubKey.slice(1, 33)),
    y: bytesToB64url(pubKey.slice(33, 65)),
  };
  await deps.primeJwks(deps.kv, [jwk], nowMs);
  // Kept ONLY in demo sessions: lets mock-confirmed gate-checked registrations
  // sign an activity pass locally (CO-002 PR-4). Real passes come from the
  // backend webhook; this key never exists outside a demo install.
  await deps.kv.set(SIGNING_KEY, bytesToHex(privKey));

  const nowSec = Math.floor(nowMs / 1000);
  const expSec = Math.floor(new Date('2026-12-01T00:00:00+05:30').getTime() / 1000);
  const passes: PassClaims[] = [
    {
      jti: 'demo-ticket-1',
      typ: 'ticket',
      sub: 'demo-user',
      evt: 'bir-festival-2026',
      zones: ['main', 'landing'],
      nbf: nowSec - 3600,
      exp: expSec,
    },
    {
      jti: 'demo-seat-1',
      typ: 'seat-entry',
      sub: 'demo-user',
      evt: 'bir-festival-2026',
      zones: ['main'],
      nbf: nowSec - 3600,
      exp: expSec,
      seat: 'B-14',
    },
  ];
  for (const claims of passes) {
    await deps.savePass(signDemoPass(privKey, claims), claims, nowMs);
  }

  for (const row of demoSchedule()) {
    await deps.insertScheduleRow(row);
  }

  // Last-known caches so the fly banner and venue pins render.
  await deps.kv.set(
    'flystatus.cache',
    JSON.stringify({
      state: 'flying',
      reasonEn: 'Demo data — clear skies over Billing',
      reasonHi: 'डेमो डेटा — बिलिंग के ऊपर साफ़ आसमान',
      updatedAtSec: nowSec,
      refundsAutoQueued: false,
    }),
  );
  await deps.kv.set(
    'venues.cache',
    JSON.stringify({
      fetchedAtMs: nowMs,
      venues: [
        {
          id: 'chogan',
          nameEn: 'Chogan Ground',
          nameHi: 'चौगान मैदान',
          lat: 32.0322,
          lng: 76.7185,
        },
        {
          id: 'landing',
          nameEn: 'Bir Landing Site',
          nameHi: 'बीड़ लैंडिंग साइट',
          lat: 32.0402,
          lng: 76.7266,
        },
        {
          id: 'billing',
          nameEn: 'Billing Take-off',
          nameHi: 'बिलिंग टेक-ऑफ़',
          lat: 32.0764,
          lng: 76.7343,
        },
      ],
    }),
  );

  await deps.kv.set(SEEDED_KEY, '1');
  return true;
}

/** OTP gate for demo entry: only the demo code opens a demo session. */
export async function tryDemoOtp(
  deps: DemoSeedDeps,
  code: string,
  nowMs: number,
): Promise<boolean> {
  if (code.trim() !== DEMO_OTP) return false;
  await enableDemoSession(deps, nowMs);
  return true;
}

/**
 * CO-002 PR-4 (demo sessions only): a mock-confirmed, gate-checked
 * registration gets a locally-signed `typ:'activity'` pass into the same
 * wallet, so the QR + offline verifier path demos end-to-end. Returns the
 * pass jti, or null when no demo signing key exists (non-demo install).
 */
export async function issueDemoActivityPass(
  deps: { kv: KvStore; savePass(token: string, claims: PassClaims, nowMs: number): Promise<void> },
  input: { itemId: string; slotId?: string; sub: string },
  nowMs: number,
): Promise<string | null> {
  const hex = await deps.kv.get(SIGNING_KEY);
  if (!hex) return null;
  const nowSec = Math.floor(nowMs / 1000);
  const claims: PassClaims = {
    jti: `demo-act-${input.itemId}-${input.slotId ?? 'na'}`,
    typ: 'activity',
    sub: input.sub,
    evt: 'bir-festival-2026',
    zones: ['activity'],
    nbf: nowSec - 3600,
    exp: Math.floor(new Date('2026-12-01T00:00:00+05:30').getTime() / 1000),
  };
  const token = signDemoPass(hexToBytes(hex), claims);
  await deps.savePass(token, claims, nowMs);
  return claims.jti;
}

/**
 * CO-003 PR-5 (demo sessions only): sign a `typ:'participant'` badge into
 * the shared wallet. Real badges come from badges.issueMutation (ASK #31);
 * this exists solely so evaluation builds demo the full badge + scanner path.
 */
export async function issueDemoParticipantBadge(
  deps: { kv: KvStore; savePass(token: string, claims: PassClaims, nowMs: number): Promise<void> },
  input: { competitionId: string; sub: string; backstage?: boolean },
  nowMs: number,
): Promise<string | null> {
  const hex = await deps.kv.get(SIGNING_KEY);
  if (!hex) return null;
  const nowSec = Math.floor(nowMs / 1000);
  const claims: PassClaims = {
    jti: `demo-badge-${input.competitionId}-${input.sub}`,
    typ: 'participant',
    sub: input.sub,
    evt: 'bir-festival-2026',
    competition: input.competitionId,
    zones: input.backstage ? ['participant', 'backstage'] : ['participant'],
    nbf: nowSec - 3600,
    exp: Math.floor(new Date('2026-12-01T00:00:00+05:30').getTime() / 1000),
  };
  const token = signDemoPass(hexToBytes(hex), claims);
  await deps.savePass(token, claims, nowMs);
  return claims.jti;
}
