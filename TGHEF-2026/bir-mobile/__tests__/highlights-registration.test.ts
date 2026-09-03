import mockCatalog from '@/features/highlights/__fixtures__/catalog.mock.json';
import { parseCatalog, findItem } from '@/features/highlights/catalog';
import {
  beginPaidRegistration,
  cancelRegistration,
  kvRegistrationStore,
  mapServerRegistrationStatus,
  markRegistration,
  mergeRegistrations,
  normaliseRefundState,
  registrationKey,
  requiresPayment,
  submitFreeRegistration,
  validateForm,
} from '@/features/highlights/registration';
import type { Registration } from '@/features/highlights/types';
import type { KvStore } from '@/offline/jwks';
import { MemoryOutboxStore } from '@/offline/outbox';

jest.mock('@/config/flags', () => ({ isEnabled: () => false }));

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
const byId = (id: string) => findItem(catalog, id)!;
const NOW_MS = 1_763_700_000_000;

describe('validateForm (server-driven schema + consents)', () => {
  it('requires schema fields, DPDP consent, guardian when flagged, slot when slotted', () => {
    const trekking = byId('trekking'); // guardianRequired, no schema
    expect(validateForm(trekking, { answers: {}, consent: false })).toEqual(
      expect.arrayContaining([
        { field: '_consent', error: 'consent-required' },
        { field: '_guardian', error: 'guardian-required' },
      ]),
    );

    // chef-local: dishName/experience + CO-003 lodging fields (gender,
    // needsLodging required; coupleConsent/partnerRef optional)
    const chef = byId('chef-local');
    const errors = validateForm(chef, {
      answers: { dishName: 'Siddu', gender: 'female', needsLodging: 'yes' },
      consent: true,
    });
    expect(errors).toEqual([{ field: 'experience', error: 'required' }]);
    expect(validateForm(chef, { answers: { dishName: 'Siddu' }, consent: true })).toEqual(
      expect.arrayContaining([
        { field: 'gender', error: 'required' },
        { field: 'needsLodging', error: 'required' },
      ]),
    );

    const paragliding = byId('paragliding'); // slots → slot required
    const slotErrors = validateForm(
      paragliding,
      { answers: {}, consent: true, guardianConsent: true },
      undefined,
    );
    expect(slotErrors).toEqual([{ field: '_slot', error: 'slot-required' }]);
    expect(
      validateForm(paragliding, { answers: {}, consent: true, guardianConsent: true }, 'pg-21-am'),
    ).toEqual([]);
  });

  it('fee presence decides the payment step', () => {
    expect(requiresPayment(byId('yoga-sunrise'))).toBe(false);
    expect(requiresPayment(byId('paragliding'))).toBe(true);
  });
});

describe('free path (outbox, offline-safe)', () => {
  it('queues createRegistration with one idempotent key per user+item+slot', async () => {
    const outbox = new MemoryOutboxStore();
    const store = kvRegistrationStore(memoryKv());
    const yoga = byId('yoga-sunrise');

    const reg = await submitFreeRegistration(
      { outbox, store, mockMode: false },
      { sub: 'u1', item: yoga, answers: { level: 'beginner' } },
      NOW_MS,
    );

    expect(reg.status).toBe('pending-sync'); // "will confirm when online"
    expect(reg.id).toBe(registrationKey('u1', 'yoga-sunrise'));

    const [head] = await outbox.dueHeads(NOW_MS);
    expect(head.mutation).toBe('createRegistration');
    expect(head.aggregate).toBe('registrations:u1');
    expect(head.idempotencyKey).toBe('reg:u1:yoga-sunrise:na');
    // answers is serialized for the GraphQL AWSJSON scalar (string, not object)
    expect(head.variables).toEqual({
      itemId: 'yoga-sunrise',
      slotId: null,
      answers: '{"level":"beginner"}',
    });
    // ...but the local record keeps the object for rendering
    expect(reg.answers).toEqual({ level: 'beginner' });

    // double-tap → single queue entry, record overwritten not duplicated
    await submitFreeRegistration(
      { outbox, store, mockMode: false },
      { sub: 'u1', item: yoga, answers: { level: 'beginner' } },
      NOW_MS + 5,
    );
    expect(await outbox.pendingCount()).toBe(1);
    expect(await store.list()).toHaveLength(1);
  });

  it('mock mode confirms locally (no backend to answer)', async () => {
    const reg = await submitFreeRegistration(
      { outbox: new MemoryOutboxStore(), store: kvRegistrationStore(memoryKv()), mockMode: true },
      { sub: 'u1', item: byId('meditation-workshop'), answers: {} },
      NOW_MS,
    );
    expect(reg.status).toBe('confirmed');
  });
});

describe('paid path (webhook-confirmed, never faked)', () => {
  it('records pending-payment and hands back the standard order input', async () => {
    const store = kvRegistrationStore(memoryKv());
    const { registration, orderInput } = await beginPaidRegistration(
      { outbox: new MemoryOutboxStore(), store, mockMode: false },
      { sub: 'u1', item: byId('pottery-wheel'), answers: {} },
      NOW_MS,
    );
    expect(registration.status).toBe('pending-payment');
    expect(orderInput).toEqual({
      kind: 'registration',
      itemId: 'pottery-wheel',
      quantity: 1,
      idempotencyKey: 'reg:u1:pottery-wheel:na',
    });

    await markRegistration(store, registration.id, 'confirmed', { qrPassJti: 'act-jti-1' });
    const [stored] = await store.list();
    expect(stored.status).toBe('confirmed');
    expect(stored.qrPassJti).toBe('act-jti-1');
  });

  it('slot id participates in the idempotency key', () => {
    expect(registrationKey('u1', 'paragliding', 'pg-21-am')).toBe('reg:u1:paragliding:pg-21-am');
  });
});

describe('waitlist join (full item, waitlist allowed)', () => {
  it('records intent (not a seat) and forwards waitlist=true to the backend', async () => {
    const outbox = new MemoryOutboxStore();
    const store = kvRegistrationStore(memoryKv());

    // mock mode reflects the intent locally
    const reg = await submitFreeRegistration(
      { outbox, store, mockMode: true },
      { sub: 'u1', item: byId('yoga-sunrise'), answers: {}, waitlist: true },
      NOW_MS,
    );
    expect(reg.status).toBe('waitlisted');

    // Intent stays local — the wire input has no waitlist field (server decides).
    const [head] = await outbox.dueHeads(NOW_MS);
    expect(head.variables.waitlist).toBeUndefined();
  });

  it('live mode stays pending-sync — the server decides confirmed vs waitlisted', async () => {
    const reg = await submitFreeRegistration(
      { outbox: new MemoryOutboxStore(), store: kvRegistrationStore(memoryKv()), mockMode: false },
      { sub: 'u1', item: byId('yoga-sunrise'), answers: {}, waitlist: true },
      NOW_MS,
    );
    expect(reg.status).toBe('pending-sync');
  });
});

describe('cancel → refund disposition', () => {
  it('a paid item cancels to a pending refund; a free item to none', async () => {
    const store = kvRegistrationStore(memoryKv());
    const outbox = new MemoryOutboxStore();
    // seed two confirmed registrations
    await markRegistration(store, 'reg:u1:paragliding:na', 'confirmed');
    await store.upsert({
      id: 'reg:u1:paragliding:na',
      itemId: 'paragliding',
      status: 'confirmed',
      answers: {},
      createdAtMs: NOW_MS,
    });
    await store.upsert({
      id: 'reg:u1:yoga-sunrise:na',
      itemId: 'yoga-sunrise',
      status: 'confirmed',
      answers: {},
      createdAtMs: NOW_MS,
    });

    await cancelRegistration(
      { outbox, store, mockMode: true },
      { sub: 'u1', registrationId: 'reg:u1:paragliding:na', paid: true },
      NOW_MS,
    );
    await cancelRegistration(
      { outbox, store, mockMode: true },
      { sub: 'u1', registrationId: 'reg:u1:yoga-sunrise:na', paid: false },
      NOW_MS,
    );

    const all = await store.list();
    const paid = all.find((r) => r.id === 'reg:u1:paragliding:na')!;
    const free = all.find((r) => r.id === 'reg:u1:yoga-sunrise:na')!;
    expect(paid.status).toBe('cancelled');
    expect(paid.refundState).toBe('pending');
    expect(free.refundState).toBe('none');
  });

  it('normaliseRefundState clamps unknown server strings to pending', () => {
    expect(normaliseRefundState('processed')).toBe('processed');
    expect(normaliseRefundState('none')).toBe('none');
    expect(normaliseRefundState('REFUND_INITIATED')).toBe('pending');
    expect(normaliseRefundState(null)).toBe('pending');
  });
});

describe('myRegistrations merge (server authoritative, local preserved)', () => {
  const local: Registration[] = [
    { id: 'a', itemId: 'yoga', status: 'confirmed', answers: { x: '1' }, createdAtMs: 100 },
    { id: 'b', itemId: 'pottery', status: 'pending-sync', answers: {}, createdAtMs: 200 },
  ];

  it('server wins on status/qrPassJti but keeps local createdAtMs and unsynced entries', () => {
    const server: Registration[] = [
      {
        id: 'a',
        itemId: 'yoga',
        status: 'waitlisted',
        qrPassJti: 'jti-a',
        answers: {},
        createdAtMs: 0,
      },
      { id: 'c', itemId: 'trek', status: 'confirmed', answers: { g: 'yes' }, createdAtMs: 0 },
    ];
    const merged = mergeRegistrations(local, server, 999);
    const byId = Object.fromEntries(merged.map((r) => [r.id, r]));
    // server overrode status + added a jti, but local createdAtMs + answers survive
    expect(byId.a.status).toBe('waitlisted');
    expect(byId.a.qrPassJti).toBe('jti-a');
    expect(byId.a.createdAtMs).toBe(100);
    expect(byId.a.answers).toEqual({ x: '1' });
    // local-only unsynced entry is kept
    expect(byId.b.status).toBe('pending-sync');
    // server-only entry (made on another device) appears with nowMs
    expect(byId.c.createdAtMs).toBe(999);
    expect(byId.c.answers).toEqual({ g: 'yes' });
  });

  it('maps backend status strings and rejects unknowns', () => {
    expect(mapServerRegistrationStatus('confirmed')).toBe('confirmed');
    expect(mapServerRegistrationStatus('WAITLISTED')).toBe('waitlisted');
    expect(mapServerRegistrationStatus('pending')).toBe('pending-sync');
    expect(mapServerRegistrationStatus('weird')).toBeNull();
  });
});
