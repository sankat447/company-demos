#!/usr/bin/env node
/**
 * seed-demo-user.mjs — populate ONE fixed demo user's PERSONAL screens.
 *
 * The visitor "More" / pass screens are keyed to the signed-in Cognito `sub`
 * (My Ticket, My Registrations, My Roster, My Stall). A generic signup has none
 * of that data, so this seeds it for a single, known demo phone number — hand
 * that number out for the demo (any number still logs in; only this one has the
 * personal data). Idempotent: stable keys, re-runnable.
 *
 *   DEMO_PHONE=+919000000001 TABLE=bir-2026-table AWS_PROFILE=rhoai-demo \
 *     AWS_REGION=us-east-1 POOL=us-east-1_LwsiJjOK2 node scripts/seed-demo-user.mjs
 *
 * Requires: aws CLI (authenticated), node. Resolves the sub itself.
 *
 * Screens covered (see the data-shape map): PROFILE row → /ticket master pass QR
 * (lambda mints the ES256 token on demand); REG rows → My Registrations (+ the
 * lodging pool); VOL/<sub> → My Roster; STALL/<sub> → My Stall (rules/rulesHi
 * REQUIRED or the screen crashes). The pass-WALLET tab and the participant
 * lodging card are local/admin-only and are demoed on the admin side instead.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TABLE = process.env.TABLE || 'bir-2026-table';
const REGION = process.env.AWS_REGION || 'us-east-1';
const PROFILE = process.env.AWS_PROFILE;
const POOL = process.env.POOL || 'us-east-1_LwsiJjOK2';
const PHONE = process.env.DEMO_PHONE || '+919000000001';
const tmp = mkdtempSync(join(tmpdir(), 'seed-user-'));
const awsBase = ['--region', REGION, ...(PROFILE ? ['--profile', PROFILE] : [])];

const at = (day, hm) => Math.floor(Date.parse(`${day}T${hm}:00+05:30`) / 1000);
const now = Math.floor(Date.now() / 1000);
const D1 = '2026-11-21', D2 = '2026-11-22';

// ---- resolve the Cognito sub for the demo phone ----
function resolveSub() {
  try {
    const out = execFileSync('aws', ['cognito-idp', 'admin-get-user', '--user-pool-id', POOL,
      '--username', PHONE, '--query', 'UserAttributes[?Name==`sub`].Value | [0]',
      '--output', 'text', ...awsBase], { encoding: 'utf8' }).trim();
    if (out && out !== 'None') return out;
  } catch { /* fall through to list-users */ }
  const j = execFileSync('aws', ['cognito-idp', 'list-users', '--user-pool-id', POOL,
    '--filter', `phone_number="${PHONE}"`, '--output', 'json', ...awsBase], { encoding: 'utf8' });
  const u = JSON.parse(j).Users?.[0];
  const sub = u?.Attributes?.find((a) => a.Name === 'sub')?.Value;
  if (!sub) throw new Error(`No Cognito user for ${PHONE} — sign it up first (any number + OTP 000000).`);
  return sub;
}

function av(v) {
  if (v === null || v === undefined) return { NULL: true };
  if (typeof v === 'string') return { S: v };
  if (typeof v === 'number') return { N: String(v) };
  if (typeof v === 'boolean') return { BOOL: v };
  if (Array.isArray(v)) return { L: v.map(av) };
  if (typeof v === 'object') return { M: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, av(x)])) };
  return { NULL: true };
}
const row = (pk, sk, fields) => ({
  PutRequest: { Item: { pk: { S: pk }, sk: { S: sk }, ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, av(v)])) } },
});

const SUB = resolveSub();
console.log(`Seeding personal demo data for ${PHONE} → sub ${SUB}`);
const NAME = 'Tenzin Dorje';
const reqs = [];

// 1) PROFILE → /ticket master festival pass (master-pass lambda mints the token)
reqs.push(row(`PROFILE#${SUB}`, 'PROFILE', {
  displayName: NAME, dob: '1996-05-14', consentDpdp: true,
  consentVersion: '2026-v1', consentAt: now, updatedAt: now,
}));

// 2) REG rows → My Registrations (+ lodging pool). sk begins reg:<sub>:
const reg = (itemId, slot, needsLodging, nights) => {
  const sk = `reg:${SUB}:${itemId}:${slot}`;
  reqs.push(row('REG', sk, {
    registrationId: sk, regId: sk, itemId, slotId: slot, status: 'confirmed',
    name: NAME, competitionId: itemId, gender: 'male',
    needsLodging, ...(needsLodging ? { nights } : {}),
    answers: JSON.stringify({ name: NAME, phone: PHONE, needsLodging: needsLodging ? 'yes' : 'no', gender: 'male' }),
    createdAt: now,
  }));
};
reg('tandem-flight', 'slot-d1-0800', true, [D1, D2]); // needs lodging → shows in admin pool
reg('chef-local', 'slot-d2-1400', false, []);

// 3) VOL/<sub> → My Roster (my shifts)
reqs.push(row('VOL', SUB, {
  sub: SUB, name: NAME, team: 'Landing Zone', idVerified: true, certificateJti: `cert-${SUB}-2026`,
  shifts: [
    { id: 'sh-1', date: D1, zone: 'Landing · Chougan', role: 'Marshal', startsAtSec: at(D1, '09:00'), endsAtSec: at(D1, '15:00') },
    { id: 'sh-2', date: D2, zone: 'Landing · Chougan', role: 'Marshal', startsAtSec: at(D2, '09:00'), endsAtSec: at(D2, '15:00') },
  ],
  updatedAt: now, updatedBy: 'seed:demo-user',
}));

// 4) STALL/<sub> → My Stall (rules/rulesHi REQUIRED — the console crashes without them)
reqs.push(row('STALL', SUB, {
  stallName: 'Himalayan Momos', category: 'food', stage: 'allocated', allocationLabel: 'F-12',
  feeInr: 4000, paid: true, paidMethod: 'cash/offline', paidAt: now - 3600, paidBy: 'admin:demo',
  analytics: JSON.stringify([
    { day: D1, ordersEstimate: 180, footfallIndex: 72 },
    { day: D2, ordersEstimate: 240, footfallIndex: 81 },
  ]),
  rules: [
    'Cooking-gas cylinders must be secured and inspected daily.',
    'Segregate wet and dry waste at the marked bins.',
    'Stall lights off by 11 PM; generator use only in the marked bay.',
  ],
  rulesHi: [
    'गैस सिलेंडर सुरक्षित रखें और रोज़ जाँच कराएँ।',
    'गीला और सूखा कचरा अलग-अलग बिन में डालें।',
    'रात 11 बजे तक स्टॉल की लाइट बंद; जनरेटर केवल निर्धारित जगह पर।',
  ],
  updatedAt: now, updatedBy: 'seed:demo-user',
}));

// ---- write ----
const body = { [TABLE]: reqs };
const f = join(tmp, 'batch.json');
writeFileSync(f, JSON.stringify(body));
const out = execFileSync('aws', ['dynamodb', 'batch-write-item', '--request-items', `file://${f}`, ...awsBase], { encoding: 'utf8' });
const un = (JSON.parse(out).UnprocessedItems || {})[TABLE] || [];
console.log(`✓ wrote ${reqs.length - un.length}/${reqs.length} personal rows` + (un.length ? ` (⚠ ${un.length} unprocessed)` : ''));
console.log('Screens now populated for this login: My Ticket (master pass QR), My Registrations, My Roster, My Stall.');
