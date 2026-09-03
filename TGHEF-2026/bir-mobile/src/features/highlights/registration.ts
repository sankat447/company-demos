/**
 * The ONE standard registration engine (CO-002 §3) — identical for every
 * regMode !== 'view-only' item; categories may only specialise via the
 * catalog flags (slots, guardian, weather), never with their own copy.
 *
 * Free items: queue through the outbox (offline-safe, "will confirm when
 * online"). Paid items: the webhook-confirmed order pattern from
 * ARCHITECTURE.md §5 — connectivity required, a payment is NEVER faked.
 */
import type { KvStore } from '@/offline/jwks';
import type { OutboxStore } from '@/offline/outbox';

import type {
  FormField,
  HighlightItem,
  RefundState,
  Registration,
  RegistrationStatus,
} from './types';

// ---------- validation ----------

export interface FormInput {
  answers: Record<string, string>;
  consent: boolean;
  guardianConsent?: boolean;
}

export type FormError =
  | { field: string; error: 'required' }
  | { field: '_consent'; error: 'consent-required' }
  | { field: '_guardian'; error: 'guardian-required' }
  | { field: '_slot'; error: 'slot-required' };

export function validateForm(item: HighlightItem, input: FormInput, slotId?: string): FormError[] {
  const errors: FormError[] = [];
  for (const field of item.formSchema ?? []) {
    if (field.required && !(input.answers[field.key] ?? '').trim()) {
      errors.push({ field: field.key, error: 'required' });
    }
  }
  if (!input.consent) errors.push({ field: '_consent', error: 'consent-required' });
  if (item.guardianRequired && !input.guardianConsent) {
    errors.push({ field: '_guardian', error: 'guardian-required' });
  }
  if (item.slots?.length && !slotId) errors.push({ field: '_slot', error: 'slot-required' });
  return errors;
}

export function requiresPayment(item: HighlightItem): boolean {
  return (item.fee?.amount ?? 0) > 0;
}

/**
 * CO-002 paragliding delta: a weather-sensitive item cannot take
 * registrations while the safety officer's hold/closure is active. Unknown
 * status does NOT block (this gates bookings, not flights — the officer's
 * live call gates the flight itself).
 */
export function weatherBlocked(
  item: HighlightItem,
  flyState: 'flying' | 'hold' | 'closed' | null,
): boolean {
  return item.weatherSensitive === true && flyState !== null && flyState !== 'flying';
}

/** One registration per user+item+slot — retries and drains reconcile on it. */
export function registrationKey(sub: string, itemId: string, slotId?: string): string {
  return `reg:${sub}:${itemId}:${slotId ?? 'na'}`;
}

// ---------- persistence ----------

export interface RegistrationStore {
  list(): Promise<Registration[]>;
  upsert(registration: Registration): Promise<void>;
}

const STORE_KEY = 'highlights.registrations';

/** kv-backed store: registrations render offline like everything else. */
export function kvRegistrationStore(kv: KvStore): RegistrationStore {
  async function read(): Promise<Registration[]> {
    const rawValue = await kv.get(STORE_KEY);
    if (!rawValue) return [];
    try {
      return JSON.parse(rawValue) as Registration[];
    } catch {
      return [];
    }
  }
  return {
    list: read,
    async upsert(registration) {
      const all = await read();
      const next = all.filter((r) => r.id !== registration.id);
      next.push(registration);
      await kv.set(STORE_KEY, JSON.stringify(next));
    },
  };
}

// ---------- submission ----------

export interface SubmitDeps {
  outbox: OutboxStore;
  store: RegistrationStore;
  /** flags.mockHighlights: no backend — free registrations confirm locally. */
  mockMode: boolean;
}

export interface SubmitInput {
  sub: string;
  item: HighlightItem;
  slotId?: string;
  answers: Record<string, string>;
  /** The item is full but takes a waitlist — record intent, not a confirmed seat. */
  waitlist?: boolean;
}

/**
 * Free path. Queues createRegistration (ASK #22) through the outbox and
 * records the registration locally as pending-sync — the "will confirm when
 * online" state the spec requires. In mock mode it confirms locally since
 * there is no backend to answer.
 */
export async function submitFreeRegistration(
  deps: SubmitDeps,
  input: SubmitInput,
  nowMs: number,
): Promise<Registration> {
  const id = registrationKey(input.sub, input.item.id, input.slotId);
  await deps.outbox.enqueue(
    {
      aggregate: `registrations:${input.sub}`,
      mutation: 'createRegistration',
      // `answers` maps to the GraphQL AWSJSON scalar, which requires a JSON
      // STRING — AppSync rejects a raw object ("invalid value"). Serialize here;
      // the local record below keeps the object for rendering.
      // The CreateRegistrationInput schema is {itemId, slotId, answers,
      // idempotencyKey} — there is no waitlist field. The server decides
      // confirmed vs waitlisted from live capacity, so intent stays local.
      variables: {
        itemId: input.item.id,
        slotId: input.slotId ?? null,
        answers: JSON.stringify(input.answers),
      },
      idempotencyKey: id,
    },
    nowMs,
  );
  // Live: always pending-sync — the server's ack decides confirmed vs
  // waitlisted (reconciled by the outbox drain). Mock: reflect intent locally.
  const status: RegistrationStatus = deps.mockMode
    ? input.waitlist
      ? 'waitlisted'
      : 'confirmed'
    : 'pending-sync';
  const registration: Registration = {
    id,
    itemId: input.item.id,
    slotId: input.slotId,
    status,
    answers: input.answers,
    createdAtMs: nowMs,
  };
  await deps.store.upsert(registration);
  return registration;
}

/**
 * Paid path, step 1: record pending-payment and hand the caller the order
 * input for the standard webhook-confirmed flow (createOrder → provider
 * checkout → onOrderConfirmed). Never callable offline — the screen blocks.
 */
export async function beginPaidRegistration(
  deps: SubmitDeps,
  input: SubmitInput,
  nowMs: number,
): Promise<{
  registration: Registration;
  orderInput: { kind: 'registration'; itemId: string; quantity: number; idempotencyKey: string };
}> {
  const id = registrationKey(input.sub, input.item.id, input.slotId);
  const registration: Registration = {
    id,
    itemId: input.item.id,
    slotId: input.slotId,
    status: 'pending-payment',
    answers: input.answers,
    createdAtMs: nowMs,
  };
  await deps.store.upsert(registration);
  return {
    registration,
    orderInput: { kind: 'registration', itemId: input.item.id, quantity: 1, idempotencyKey: id },
  };
}

/** Paid path, step 2 (after webhook confirmation) or waitlist promotion. */
export async function markRegistration(
  store: RegistrationStore,
  id: string,
  status: RegistrationStatus,
  extra?: { qrPassJti?: string; refundState?: RefundState },
): Promise<void> {
  const all = await store.list();
  const existing = all.find((r) => r.id === id);
  if (!existing) return;
  await store.upsert({
    ...existing,
    status,
    qrPassJti: extra?.qrPassJti ?? existing.qrPassJti,
    refundState: extra?.refundState ?? existing.refundState,
  });
}

/** Normalise the backend's refundState string onto our closed union. */
export function normaliseRefundState(raw: string | null | undefined): RefundState {
  if (raw === 'none' || raw === 'processed') return raw;
  return 'pending';
}

/** Map the backend's registration status string onto our closed union. */
export function mapServerRegistrationStatus(raw: unknown): RegistrationStatus | null {
  switch (String(raw).toLowerCase()) {
    case 'confirmed':
      return 'confirmed';
    case 'waitlisted':
      return 'waitlisted';
    case 'cancelled':
      return 'cancelled';
    case 'pending':
    case 'pending-sync':
      return 'pending-sync';
    default:
      return null; // unknown → don't downgrade the local record
  }
}

/**
 * Merge the server-authoritative registrations (myRegistrations, B1) over the
 * local ones. The server wins for status/qrPassJti; local-only entries not yet
 * synced (pending-sync/pending-payment) are kept, and local createdAtMs / badge
 * / provisional refund fields are preserved so nothing the device knows is lost.
 */
export function mergeRegistrations(
  local: Registration[],
  server: Registration[],
  nowMs: number,
): Registration[] {
  const byId = new Map(local.map((r) => [r.id, r]));
  for (const s of server) {
    const existing = byId.get(s.id);
    byId.set(s.id, {
      ...existing,
      ...s,
      answers: Object.keys(s.answers ?? {}).length ? s.answers : (existing?.answers ?? {}),
      createdAtMs: existing?.createdAtMs ?? nowMs,
      qrPassJti: s.qrPassJti ?? existing?.qrPassJti,
      refundState: s.refundState ?? existing?.refundState,
    });
  }
  return [...byId.values()];
}

/**
 * Cancel (P5.9, ASK #24). Queues the mutation (policy + refund state are the
 * backend's call — the app renders only) and marks the local record
 * cancelled so the UI reflects intent immediately.
 */
export async function cancelRegistration(
  deps: SubmitDeps,
  input: { sub: string; registrationId: string; paid?: boolean },
  nowMs: number,
): Promise<void> {
  if (!deps.mockMode) {
    await deps.outbox.enqueue(
      {
        aggregate: `registrations:${input.sub}`,
        mutation: 'cancelRegistration',
        variables: { registrationId: input.registrationId },
        idempotencyKey: `cancel:${input.registrationId}`,
      },
      nowMs,
    );
  }
  // Provisional refund disposition so the UI reflects it immediately. A free
  // item has nothing to refund; a paid one starts as pending (T+2). In live
  // mode the outbox reconcile overwrites this with the server's authoritative
  // RegistrationAck.refundState when the mutation drains.
  const refundState: RefundState = input.paid ? 'pending' : 'none';
  await markRegistration(deps.store, input.registrationId, 'cancelled', { refundState });
}

// ---------- helpers for the form renderer ----------

export function fieldLabel(field: FormField, locale: 'en' | 'hi'): string {
  return locale === 'hi' && field.labelHi ? field.labelHi : field.label;
}
