/**
 * B1: the server-authoritative registration list for the signed-in visitor
 * (myRegistrations). Kept out of the pure registration.ts so its unit tests
 * stay Amplify-free. Mock mode has no backend and returns [] — the local kv
 * store is the whole picture there.
 */
import { gqlClient, MY_REGISTRATIONS } from '@/api/graphql';
import { isEnabled } from '@/config/flags';

import { mapServerRegistrationStatus } from './registration';
import type { Registration } from './types';

interface ServerRegistration {
  id: string;
  itemId: string;
  slotId?: string | null;
  status: string;
  qrPassJti?: string | null;
  /** AWSJSON — a JSON string. */
  answers?: string | null;
}

function parseAnswers(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function fromServer(s: ServerRegistration, nowMs: number): Registration {
  return {
    id: s.id,
    itemId: s.itemId,
    slotId: s.slotId ?? undefined,
    status: mapServerRegistrationStatus(s.status) ?? 'confirmed',
    qrPassJti: s.qrPassJti ?? undefined,
    answers: parseAnswers(s.answers),
    createdAtMs: nowMs,
  };
}

export async function fetchMyRegistrations(nowMs: number): Promise<Registration[]> {
  if (isEnabled('mockHighlights')) return [];
  const res = (await gqlClient().graphql({ query: MY_REGISTRATIONS })) as {
    data?: { myRegistrations?: ServerRegistration[] };
  };
  return (res.data?.myRegistrations ?? []).map((s) => fromServer(s, nowMs));
}
