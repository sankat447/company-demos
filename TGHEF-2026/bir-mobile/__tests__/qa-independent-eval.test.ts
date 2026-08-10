/**
 * INDEPENDENT EVALUATION SUITE — authored by the QA evaluator, NOT the
 * developer. Fresh test data, adversarial intent: each block tries to BREAK
 * a requirement rather than confirm it. Traceability tags map to the four
 * spec docs and the change orders (CO-001..CO-003).
 *
 * Scope: everything executable without a device (pure business logic +
 * crypto). UI/native paths are assessed by code review in the report.
 */
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import fc from 'fast-check';

import { bytesToB64url, stringToUtf8 } from '@/offline/encoding';
import { verifyPass, type EcJwk, type PassClaims } from '@/offline/verifier';
import { evaluateScan } from '@/features/scanner/verdict';
import { BACKOFF, backoffDelayMs, drainOutbox, MemoryOutboxStore } from '@/offline/outbox';
import { propose, validateMove } from '@/features/lodging/engine';
import { rosterHtml } from '@/features/lodging/allocation';
import { badgesPdfHtml, shouldIssueBadge, lodgingResolved } from '@/features/badges/badges';
import { validateForm, requiresPayment } from '@/features/highlights/registration';
import { validateRoom } from '@/features/lodging/rooms';
import type { Participant, Room } from '@/features/lodging/types';
import type { HighlightItem, Registration } from '@/features/highlights/types';

// ---- QA test-key infrastructure (evaluator-generated, distinct from app) ----
const issuerKey = p256.utils.randomPrivateKey();
const issuerPub = p256.getPublicKey(issuerKey, false);
const KID = 'bir-2026-01';
const jwks: EcJwk[] = [
  {
    kty: 'EC',
    crv: 'P-256',
    kid: KID,
    x: bytesToB64url(issuerPub.slice(1, 33)),
    y: bytesToB64url(issuerPub.slice(33, 65)),
  },
];
const NOW = 1_763_800_000; // within festival window, seconds
const enc = (o: unknown) => bytesToB64url(stringToUtf8(JSON.stringify(o)));
function issue(claims: Partial<PassClaims>, signWith = issuerKey, kid = KID): string {
  const full: PassClaims = {
    jti: 'qa-pass',
    typ: 'ticket',
    sub: 'qa-user',
    evt: 'bir-festival-2026',
    zones: ['main'],
    nbf: NOW - 3600,
    exp: NOW + 3600,
    ...claims,
  };
  const header = enc({ alg: 'ES256', kid });
  const payload = enc(full);
  const sig = p256.sign(sha256(stringToUtf8(`${header}.${payload}`)), signWith).toCompactRawBytes();
  return `${header}.${payload}.${bytesToB64url(sig)}`;
}

// =====================================================================
// TR-SEC-01  Offline gate security (ARCHITECTURE §6, CO-001 E1)
// =====================================================================
describe('TR-SEC-01 offline pass verification cannot be forged', () => {
  it('accepts a legitimately issued pass', () => {
    expect(verifyPass(issue({}), jwks, NOW).ok).toBe(true);
  });

  it('rejects a pass signed by an attacker key with the real kid', () => {
    const attacker = p256.utils.randomPrivateKey();
    const forged = issue({ sub: 'gatecrasher' }, attacker, KID);
    expect(verifyPass(forged, jwks, NOW)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects payload tampering that keeps the original signature', () => {
    const good = issue({ zones: ['main'] });
    const [h, , s] = good.split('.');
    const escalated = `${h}.${enc({ jti: 'qa-pass', typ: 'ticket', sub: 'qa', evt: 'x', zones: ['main', 'vip', 'backstage'], nbf: NOW - 1, exp: NOW + 9999 })}.${s}`;
    expect(verifyPass(escalated, jwks, NOW)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects alg:none downgrade', () => {
    const header = enc({ alg: 'none', kid: KID });
    const payload = enc({
      jti: 'x',
      typ: 'ticket',
      sub: 'a',
      evt: 'e',
      zones: ['main'],
      nbf: NOW - 1,
      exp: NOW + 1,
    });
    expect(verifyPass(`${header}.${payload}.`, jwks, NOW).ok).toBe(false);
  });

  it('enforces the time window beyond clock skew (expired + not-yet-valid)', () => {
    expect(verifyPass(issue({ exp: NOW - 3600 }), jwks, NOW)).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(verifyPass(issue({ nbf: NOW + 3600 }), jwks, NOW)).toEqual({
      ok: false,
      reason: 'not-yet-valid',
    });
  });

  it('gate verdict: revoked > wrong-zone > duplicate precedence and each blocks entry', () => {
    const ctxBase = {
      jwks,
      nowSec: NOW,
      gateZone: 'main',
      isRevoked: () => false,
      isDuplicate: () => false,
    };
    expect(
      evaluateScan(issue({ jti: 'r1' }), { ...ctxBase, isRevoked: (j: string) => j === 'r1' })
        .verdict,
    ).toBe('revoked');
    expect(evaluateScan(issue({ zones: ['landing'] }), ctxBase).verdict).toBe('wrong-zone');
    expect(evaluateScan(issue({}), { ...ctxBase, isDuplicate: () => true }).verdict).toBe(
      'duplicate',
    );
    expect(evaluateScan(issue({}), ctxBase).verdict).toBe('valid');
  });

  it('a CO-003 participant badge verifies on the SAME gate path', () => {
    const badge = issue({
      jti: 'badge-1',
      typ: 'participant',
      competition: 'him-queen-2026',
      zones: ['participant'],
    });
    const res = verifyPass(badge, jwks, NOW);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.claims.typ).toBe('participant');
  });
});

// =====================================================================
// TR-OFF-01  Offline write durability (CLAUDE rule 2, ARCHITECTURE §4)
// =====================================================================
describe('TR-OFF-01 outbox never loses or duplicates a write', () => {
  it('a failing aggregate cannot starve or drop another aggregate', async () => {
    const store = new MemoryOutboxStore();
    await store.enqueue(
      {
        aggregate: 'scans:gateA',
        mutation: 'recordScan',
        variables: { n: 1 },
        idempotencyKey: 'k1',
      },
      0,
    );
    await store.enqueue(
      { aggregate: 'votes:u1', mutation: 'castVote', variables: { n: 2 }, idempotencyKey: 'k2' },
      0,
    );
    const sent: string[] = [];
    const stats = await drainOutbox(
      store,
      async (r) => {
        if (r.aggregate === 'scans:gateA') throw new Error('gate offline');
        sent.push(r.idempotencyKey);
      },
      { nowMs: () => 10 },
    );
    expect(sent).toEqual(['k2']); // the healthy write went through
    expect(stats.failed).toBe(1);
    expect(await store.pendingCount()).toBe(1); // the failed one is retained, not lost
  });

  it('duplicate idempotency keys collapse to a single queued write', async () => {
    const store = new MemoryOutboxStore();
    for (let i = 0; i < 5; i++)
      await store.enqueue(
        { aggregate: 'a', mutation: 'm', variables: {}, idempotencyKey: 'same' },
        i,
      );
    expect(await store.pendingCount()).toBe(1);
  });

  it('backoff is bounded and monotonic to the cap (no unbounded retry storm)', () => {
    const noJitter = () => 0;
    let prev = 0;
    for (let a = 0; a <= 12; a++) {
      const d = backoffDelayMs(a, noJitter);
      expect(d).toBeGreaterThanOrEqual(prev === 0 ? 0 : prev * 0.99);
      expect(d).toBeLessThanOrEqual(BACKOFF.capMs);
      prev = d;
    }
  });
});

// =====================================================================
// TR-PAY-01  Payment integrity (ARCHITECTURE §5, CLAUDE "never mock a payment")
// =====================================================================
describe('TR-PAY-01 the client cannot self-confirm a payment', () => {
  it('a fee-bearing item is flagged as requiring the webhook path', () => {
    const paid = { fee: { amount: 500, currency: 'INR' } } as HighlightItem;
    const free = {} as HighlightItem;
    expect(requiresPayment(paid)).toBe(true);
    expect(requiresPayment(free)).toBe(false);
  });
  // NOTE: the confirm-only-via-onOrderConfirmed contract is enforced in
  // purchase.ts and covered by the dev suite; UI wiring reviewed in report.
});

// =====================================================================
// TR-LODGE-01  Gender-sharing hard constraints (CO-003 §3) — the crown jewel
// Independent property test with the evaluator's OWN generators.
// =====================================================================
describe('TR-LODGE-01 §3 hard constraints hold under adversarial pools', () => {
  const gender = fc.constantFrom('female', 'male', 'other', 'undisclosed') as fc.Arbitrary<
    Participant['gender']
  >;
  const nights = fc.subarray(['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'], {
    minLength: 1,
  });

  const poolArb = fc
    .array(
      fc.record({ gender, nights, needsLodging: fc.constant(true) }).map((r) => r),
      { minLength: 0, maxLength: 20 },
    )
    .map((rows) =>
      rows.map((r, i): Participant => ({
        regId: `q${i}`,
        name: `Q${i}`,
        competitionId: 'chef-local',
        gender: r.gender,
        nights: [...r.nights].sort(),
        needsLodging: true,
      })),
    );

  const roomsArb = fc
    .array(
      fc.record({
        cap: fc.integer({ min: 1, max: 8 }),
        dbl: fc.boolean(),
        nights,
      }),
      { minLength: 0, maxLength: 10 },
    )
    .map((rows) =>
      rows.map((r, i): Room => ({
        id: `qr${i}`,
        hotelName: `QH${i % 2}`,
        roomLabel: `${i}`,
        type: r.dbl ? 'double' : 'twin',
        capacity: r.dbl ? 2 : r.cap,
        doubleOccupancy: r.dbl,
        availability: { from: '2026-11-20', to: '2026-11-24', nights: [...r.nights].sort() },
        status: 'active',
      })),
    );

  it('never mixes genders, never overfills, never auto-places undisclosed/other (2000 pools)', () => {
    fc.assert(
      fc.property(poolArb, roomsArb, (pool, rooms) => {
        const { assignments, unplaced } = propose(pool, rooms);
        const byId = new Map(pool.map((p) => [p.regId, p]));

        // no participant lost or double-counted
        const ids = [...assignments.map((a) => a.regId), ...unplaced.map((u) => u.regId)];
        expect(new Set(ids).size).toBe(pool.length);

        const perRoom = new Map<string, Participant[]>();
        for (const a of assignments)
          perRoom.set(a.roomId, [...(perRoom.get(a.roomId) ?? []), byId.get(a.regId)!]);

        for (const [roomId, occ] of perRoom) {
          const room = rooms.find((r) => r.id === roomId)!;
          // undisclosed/other must never be auto-placed into a shared room
          for (const o of occ)
            expect(o.gender === 'other' || o.gender === 'undisclosed').toBe(false);
          // single gender only
          expect(new Set(occ.map((o) => o.gender)).size).toBeLessThanOrEqual(1);
          // capacity per night
          for (const n of ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']) {
            const c = occ.filter((o) => o.nights.includes(n)).length;
            expect(c).toBeLessThanOrEqual(room.capacity);
            if (c > 0) expect(room.availability.nights).toContain(n);
          }
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('couples are inseparable and their double room is invasion-proof', () => {
    const pool: Participant[] = [
      {
        regId: 'h',
        name: 'Him',
        competitionId: 'c',
        gender: 'male',
        coupleGroupId: 'cg',
        nights: ['2026-11-21'],
        needsLodging: true,
      },
      {
        regId: 'w',
        name: 'Her',
        competitionId: 'c',
        gender: 'female',
        coupleGroupId: 'cg',
        nights: ['2026-11-21'],
        needsLodging: true,
      },
      {
        regId: 'x',
        name: 'Third',
        competitionId: 'c',
        gender: 'male',
        nights: ['2026-11-21'],
        needsLodging: true,
      },
    ];
    const rooms: Room[] = [
      {
        id: 'd',
        hotelName: 'H',
        roomLabel: 'D',
        type: 'double',
        capacity: 2,
        doubleOccupancy: true,
        availability: { from: '2026-11-20', to: '2026-11-24', nights: ['2026-11-21'] },
        status: 'active',
      },
      {
        id: 't',
        hotelName: 'H',
        roomLabel: 'T',
        type: 'twin',
        capacity: 2,
        doubleOccupancy: false,
        availability: { from: '2026-11-20', to: '2026-11-24', nights: ['2026-11-21'] },
        status: 'active',
      },
    ];
    const { assignments } = propose(pool, rooms);
    const hRoom = assignments.find((a) => a.regId === 'h')!.roomId;
    const wRoom = assignments.find((a) => a.regId === 'w')!.roomId;
    expect(hRoom).toBe(wRoom); // together
    expect(assignments.filter((a) => a.roomId === hRoom)).toHaveLength(2); // no third bed
    // an admin adjust cannot force the third person into the couple's room
    expect(validateMove(pool[2], 'd', assignments, pool, rooms)).toBe('couple-exclusive');
  });

  it('an admin drag can never smuggle a male into a female room', () => {
    const pool: Participant[] = [
      {
        regId: 'f1',
        name: 'F1',
        competitionId: 'c',
        gender: 'female',
        nights: ['2026-11-21'],
        needsLodging: true,
      },
      {
        regId: 'm1',
        name: 'M1',
        competitionId: 'c',
        gender: 'male',
        nights: ['2026-11-21'],
        needsLodging: true,
      },
    ];
    const rooms: Room[] = [
      {
        id: 'a',
        hotelName: 'H',
        roomLabel: 'A',
        type: 'twin',
        capacity: 2,
        doubleOccupancy: false,
        availability: { from: '2026-11-20', to: '2026-11-24', nights: ['2026-11-21'] },
        status: 'active',
      },
    ];
    const assignments = [{ regId: 'f1', roomId: 'a' }];
    expect(validateMove(pool[1], 'a', assignments, pool, rooms)).toBe('gender-mix');
  });
});

// =====================================================================
// TR-PRIV-01  Privacy: gender is lodging-only (CO-003 §5)
// =====================================================================
describe('TR-PRIV-01 gender never leaves the hospitality context', () => {
  const rooms: Room[] = [
    {
      id: 'r1',
      hotelName: 'Surya',
      roomLabel: '101',
      type: 'twin',
      capacity: 2,
      doubleOccupancy: false,
      availability: { from: '2026-11-20', to: '2026-11-24', nights: ['2026-11-21'] },
      status: 'active',
    },
  ];
  const pool: Participant[] = [
    {
      regId: 'p1',
      name: 'Anita Thakur',
      competitionId: 'him-queen-2026',
      gender: 'female',
      nights: ['2026-11-21'],
      needsLodging: true,
    },
  ];
  const alloc = { assignments: [{ regId: 'p1', roomId: 'r1' }], committedAtMs: 0, version: 1 };

  it('hotel roster shows names only — no gender, no competition id', () => {
    const html = rosterHtml('Surya', rooms, alloc, pool);
    expect(html).toContain('Anita Thakur');
    expect(html).not.toMatch(/female|male|undisclosed|gender/i);
    expect(html).not.toContain('him-queen-2026');
  });

  it('bulk badge PDF carries names + numbers but never gender', () => {
    const html = badgesPdfHtml('Himalayan Queen 2026', [
      { name: 'Anita Thakur', number: 'P-101', jtiNote: 'x' },
    ]);
    expect(html).toContain('Anita Thakur');
    expect(html).not.toMatch(/female|male|gender/i);
  });
});

// =====================================================================
// TR-BADGE-01  Badge issuance gating (CO-003 §4)
// =====================================================================
describe('TR-BADGE-01 badges issue only when confirmed AND lodging resolved', () => {
  const comp = { id: 'him-queen-2026', categoryId: 'competitions' } as HighlightItem;
  const noncomp = { id: 'yoga', categoryId: 'yoga-wellness' } as HighlightItem;
  const reg = (o: Partial<Registration>): Registration => ({
    id: 'reg1',
    itemId: 'him-queen-2026',
    status: 'confirmed',
    answers: { needsLodging: 'yes' },
    createdAtMs: 0,
    ...o,
  });
  const allocated = { assignments: [{ regId: 'reg1', roomId: 'r' }], committedAtMs: 0, version: 1 };

  it('needs-lodging participant gets a badge ONLY after allocation', () => {
    expect(shouldIssueBadge(reg({}), comp, null)).toBe(false);
    expect(shouldIssueBadge(reg({}), comp, allocated)).toBe(true);
  });
  it('self-arranged lodging is resolved without any allocation', () => {
    expect(lodgingResolved(reg({ answers: { needsLodging: 'no' } }), null)).toBe(true);
    expect(shouldIssueBadge(reg({ answers: { needsLodging: 'no' } }), comp, null)).toBe(true);
  });
  it('no badge for unconfirmed, or for non-competition activities', () => {
    expect(shouldIssueBadge(reg({ status: 'pending-sync' }), comp, allocated)).toBe(false);
    expect(shouldIssueBadge(reg({ itemId: 'yoga' }), noncomp, allocated)).toBe(false);
  });
});

// =====================================================================
// TR-VAL-01  Input validation (rooms + registration forms)
// =====================================================================
describe('TR-VAL-01 form/inventory validation rejects bad data', () => {
  const room = (o: Partial<Room>): Room => ({
    id: 'x',
    hotelName: 'H',
    roomLabel: 'L',
    type: 'twin',
    capacity: 2,
    doubleOccupancy: false,
    availability: { from: '2026-11-20', to: '2026-11-24', nights: ['2026-11-21'] },
    status: 'active',
    ...o,
  });
  it('double occupancy is forced to exactly two beds', () => {
    expect(validateRoom(room({ doubleOccupancy: true, capacity: 4 }), [])).toContainEqual({
      field: 'doubleOccupancy',
      error: 'double-implies-2',
    });
  });
  it('nights outside the 20–24 Nov window are rejected', () => {
    expect(
      validateRoom(
        room({ availability: { from: '2026-11-18', to: '2026-11-25', nights: ['2026-11-18'] } }),
        [],
      ),
    ).toContainEqual({ field: 'availability', error: 'outside-window' });
  });
  it('a competition form demands gender + needsLodging consent', () => {
    const item = {
      formSchema: [
        { key: 'gender', label: 'g', labelHi: 'g', type: 'select', required: true },
        { key: 'needsLodging', label: 'n', labelHi: 'n', type: 'select', required: true },
      ],
    } as HighlightItem;
    const errs = validateForm(item, { answers: {}, consent: false });
    expect(errs).toEqual(
      expect.arrayContaining([
        { field: 'gender', error: 'required' },
        { field: 'needsLodging', error: 'required' },
        { field: '_consent', error: 'consent-required' },
      ]),
    );
  });
});
