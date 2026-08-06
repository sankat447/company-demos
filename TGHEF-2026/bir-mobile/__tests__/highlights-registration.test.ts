import mockCatalog from '@/features/highlights/__fixtures__/catalog.mock.json';
import { parseCatalog, findItem } from '@/features/highlights/catalog';
import {
  beginPaidRegistration,
  kvRegistrationStore,
  markRegistration,
  registrationKey,
  requiresPayment,
  submitFreeRegistration,
  validateForm,
} from '@/features/highlights/registration';
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

    const chef = byId('chef-local'); // formSchema with 2 required fields
    const errors = validateForm(chef, { answers: { dishName: 'Siddu' }, consent: true });
    expect(errors).toEqual([{ field: 'experience', error: 'required' }]);

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
    expect(head.variables).toEqual({
      itemId: 'yoga-sunrise',
      slotId: null,
      answers: { level: 'beginner' },
    });

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

    await markRegistration(store, registration.id, 'confirmed', 'act-jti-1');
    const [stored] = await store.list();
    expect(stored.status).toBe('confirmed');
    expect(stored.qrPassJti).toBe('act-jti-1');
  });

  it('slot id participates in the idempotency key', () => {
    expect(registrationKey('u1', 'paragliding', 'pg-21-am')).toBe('reg:u1:paragliding:pg-21-am');
  });
});
