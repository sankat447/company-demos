import { enableDemoSession, issueDemoParticipantBadge, type DemoSeedDeps } from '@/demo/demo';
import {
  badgesPdfHtml,
  lodgingResolved,
  participantNumber,
  shouldIssueBadge,
} from '@/features/badges/badges';
import mockCatalog from '@/features/highlights/__fixtures__/catalog.mock.json';
import { findItem, parseCatalog } from '@/features/highlights/catalog';
import type { Registration } from '@/features/highlights/types';
import type { KvStore } from '@/offline/jwks';
import type { PassClaims } from '@/offline/verifier';
import { verifyPass } from '@/offline/verifier';

function memoryKv(): KvStore {
  const map = new Map<string, string>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
  };
}

const catalog = parseCatalog(mockCatalog);
const NOW_MS = 1_763_700_000_000;

function reg(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 'reg:u1:him-queen-2026:na',
    itemId: 'him-queen-2026',
    status: 'confirmed',
    answers: { needsLodging: 'yes' },
    createdAtMs: NOW_MS,
    ...overrides,
  };
}

describe('badge issuance conditions (§4)', () => {
  const queen = findItem(catalog, 'him-queen-2026');
  const yoga = findItem(catalog, 'yoga-sunrise');
  const allocated = {
    assignments: [{ regId: 'reg:u1:him-queen-2026:na', roomId: 'r-1' }],
    committedAtMs: NOW_MS,
    version: 1,
  };

  it('issues when confirmed AND lodging resolved (allocated or self-arranged)', () => {
    expect(shouldIssueBadge(reg(), queen, allocated)).toBe(true);
    expect(
      shouldIssueBadge(reg({ answers: { needsLodging: 'no' } }), queen, null), // self-arranged
    ).toBe(true);
  });

  it('withholds when lodging unresolved, not confirmed, or not a competition', () => {
    expect(shouldIssueBadge(reg(), queen, null)).toBe(false); // needs lodging, none allocated
    expect(shouldIssueBadge(reg({ status: 'pending-sync' }), queen, allocated)).toBe(false);
    expect(shouldIssueBadge(reg({ itemId: 'yoga-sunrise' }), yoga, allocated)).toBe(false);
  });

  it('lodgingResolved treats explicit self-arranged as resolved', () => {
    expect(lodgingResolved(reg({ answers: { needsLodging: 'no' } }), null)).toBe(true);
    expect(lodgingResolved(reg(), null)).toBe(false);
  });

  it('participant number is stable and human-sized', () => {
    expect(participantNumber('reg:u1:him-queen-2026:na')).toBe(
      participantNumber('reg:u1:him-queen-2026:na'),
    );
    expect(participantNumber('reg:u1:him-queen-2026:na')).toMatch(/^P-\d{3}$/);
  });
});

describe('demo badge: signs typ participant, verifies on the offline scanner path', () => {
  it('round-trips through the real verifier with the competition claim', async () => {
    const kv = memoryKv();
    const jwks: Parameters<typeof verifyPass>[1] = [];
    const saved: { token: string; claims: PassClaims }[] = [];
    const deps: DemoSeedDeps = {
      kv,
      async primeJwks(_kv, keys) {
        jwks.push(...keys);
      },
      async savePass(token, claims) {
        saved.push({ token, claims });
      },
      async insertScheduleRow() {},
    };
    await enableDemoSession(deps, NOW_MS);

    const jti = await issueDemoParticipantBadge(
      { kv, savePass: deps.savePass },
      { competitionId: 'him-queen-2026', sub: 'reg:u1:him-queen-2026:na' },
      NOW_MS,
    );
    expect(jti).toBeTruthy();

    const badge = saved.find((p) => p.claims.typ === 'participant')!;
    const result = verifyPass(badge.token, jwks, Math.floor(NOW_MS / 1000));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.typ).toBe('participant');
      expect(result.claims.competition).toBe('him-queen-2026');
      expect(result.claims.zones).toContain('participant');
    }
  });
});

describe('bulk badge PDF (§5 privacy)', () => {
  it('renders names + numbers, never gender', () => {
    const html = badgesPdfHtml('Himalayan Queen 2026', [
      { name: 'Anita Thakur', number: 'P-042', jtiNote: 'reg:p1' },
      { name: 'Priya Negi', number: 'P-137', jtiNote: 'reg:p2' },
    ]);
    expect(html).toContain('Himalayan Queen 2026');
    expect(html).toContain('Anita Thakur');
    expect(html).toContain('P-137');
    expect(html).not.toMatch(/female|male|gender|undisclosed/i);
  });
});
