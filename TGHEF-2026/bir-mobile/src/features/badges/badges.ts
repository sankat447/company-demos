/**
 * CO-003 §4 participant badges. A badge issues automatically when a
 * competition registration is CONFIRMED and lodging is RESOLVED (allocated,
 * or explicitly self-arranged at registration); admins can (re)issue from
 * the participant row. Real issuance = badges.issueMutation returning the
 * ES256 JWT (ASK #31); demo builds sign locally. Revocation flows through
 * the existing revocations delta sync — nothing badge-specific to build.
 *
 * Privacy (§5): gender never appears on a badge or in the bulk print.
 */
import type { RegistrationStore } from '@/features/highlights/registration';
import type { HighlightItem, Registration } from '@/features/highlights/types';
import type { CommittedAllocation } from '@/features/lodging/allocation';

/** Lodging is resolved by allocation OR an explicit self-arranged answer. */
export function lodgingResolved(
  registration: Registration,
  allocation: CommittedAllocation | null,
): boolean {
  if (registration.answers.needsLodging === 'no') return true; // self-arranged
  return allocation?.assignments.some((a) => a.regId === registration.id) ?? false;
}

export function shouldIssueBadge(
  registration: Registration,
  item: HighlightItem | null,
  allocation: CommittedAllocation | null,
): boolean {
  return (
    registration.status === 'confirmed' &&
    item?.categoryId === 'competitions' &&
    lodgingResolved(registration, allocation)
  );
}

/** Stable human-friendly participant number derived from the registration. */
export function participantNumber(regId: string): string {
  let hash = 5381;
  for (let i = 0; i < regId.length; i++) hash = ((hash << 5) + hash + regId.charCodeAt(i)) >>> 0;
  return `P-${String(hash % 1000).padStart(3, '0')}`;
}

export interface RegistrationWithBadge extends Registration {
  badgeJti?: string;
}

export async function setRegistrationBadge(
  store: RegistrationStore,
  registrationId: string,
  badgeJti: string,
): Promise<void> {
  const all = (await store.list()) as RegistrationWithBadge[];
  const existing = all.find((r) => r.id === registrationId);
  if (!existing) return;
  await store.upsert({ ...existing, badgeJti } as Registration);
}

/** Bulk lanyard-print PDF per competition (admin; names only — §5). */
export function badgesPdfHtml(
  competitionTitle: string,
  entries: { name: string; number: string; jtiNote: string }[],
): string {
  const cards = entries
    .map(
      (e) => `<div class="badge">
        <div class="head">BIR FESTIVAL <span>2026</span></div>
        <div class="comp">${competitionTitle}</div>
        <div class="name">${e.name}</div>
        <div class="num">${e.number}</div>
        <div class="qrnote">${e.jtiNote}</div>
        <svg viewBox="0 0 280 40"><path d="M6 6 C 90 2, 190 14, 274 36" stroke="#E8A13D" stroke-width="2.5" stroke-dasharray="7 6" fill="none" stroke-linecap="round"/></svg>
      </div>`,
    )
    .join('');
  return `<html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:16px;display:flex;flex-wrap:wrap;gap:12px}
    .badge{width:300px;height:190px;border-radius:14px;background:#17232B;color:#F7F8F5;padding:16px;page-break-inside:avoid}
    .head{font-size:11px;letter-spacing:2px;font-weight:800}
    .head span{color:#E8A13D}
    .comp{margin-top:8px;font-size:12px;color:#C9D6CE}
    .name{margin-top:10px;font-size:20px;font-weight:800}
    .num{margin-top:4px;font-size:13px;color:#E8A13D;font-weight:700}
    .qrnote{margin-top:8px;font-size:9px;color:#8FA3AD}
    svg{width:160px;margin-top:6px}
  </style></head><body>${cards}</body></html>`;
}
