/**
 * Audience-favourite voting (P3.2, CO-001 module B): votes power the award
 * ceremonies and MUST be outbox-safe offline. A vote is queued locally with
 * an idempotency key of vote:<sub>:<eventId> (one vote per user per event);
 * the auto-drain ships it whenever connectivity returns and the backend
 * reconciles duplicates on the key.
 */
import type { KvStore } from '@/offline/jwks';
import type { OutboxStore } from '@/offline/outbox';

const VOTED_KEY = 'votes.cast';

export type VoteResult = 'queued' | 'already-voted';

/** eventId → epoch-ms the vote was cast (renders "Voted ✓" offline). */
export async function votedEventIds(kv: KvStore): Promise<Record<string, number>> {
  const rawValue = await kv.get(VOTED_KEY);
  if (!rawValue) return {};
  try {
    return JSON.parse(rawValue) as Record<string, number>;
  } catch {
    return {};
  }
}

export async function castVote(
  deps: { outbox: OutboxStore; kv: KvStore },
  input: { sub: string; eventId: string; category?: string | null },
  nowMs: number,
): Promise<VoteResult> {
  const voted = await votedEventIds(deps.kv);
  if (voted[input.eventId]) return 'already-voted';

  await deps.outbox.enqueue(
    {
      aggregate: `votes:${input.sub}`,
      mutation: 'castVote',
      variables: { eventId: input.eventId, category: input.category ?? null },
      idempotencyKey: `vote:${input.sub}:${input.eventId}`,
    },
    nowMs,
  );

  voted[input.eventId] = nowMs;
  await deps.kv.set(VOTED_KEY, JSON.stringify(voted));
  return 'queued';
}
