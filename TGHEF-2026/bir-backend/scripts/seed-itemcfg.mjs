#!/usr/bin/env node
/**
 * Seed ITEMCFG/<itemId> rows from the highlights catalog. This is the backend's
 * SERVER-SIDE source of truth for an activity's fee + gating, so entitlement and
 * pricing never trust client-supplied values:
 *   - create-order prices a `registration` order from ITEMCFG.feeInr
 *   - the register-activity resolver confirms a REG row ONLY for free items
 *     (feeInr == 0); paid items are confirmed exclusively by the payment webhook
 * Prices stay editable live via the admin API (/admin/items) — this only seeds
 * the initial values from the catalog the app already ships.
 *
 * Usage: TABLE=<t> AWS_PROFILE=<p> AWS_REGION=<r> node seed-itemcfg.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const TABLE = process.env.TABLE;
const PROFILE = process.env.AWS_PROFILE;
const REGION = process.env.AWS_REGION ?? 'us-east-1';
if (!TABLE) throw new Error('TABLE env required');

function av(v) {
  if (typeof v === 'string') return { S: v };
  if (typeof v === 'number') return { N: String(v) };
  if (typeof v === 'boolean') return { BOOL: v };
  return { NULL: true };
}

const catalog = JSON.parse(readFileSync(new URL('../data/highlights-catalog.json', import.meta.url)));
const items = catalog.items || [];
let n = 0;
for (const it of items) {
  const feeInr = (it.fee && Number(it.fee.amount)) || 0;
  const row = {
    pk: { S: 'ITEMCFG' },
    sk: { S: it.id },
    itemId: { S: it.id },
    titleEn: av(it.title || it.id),
    titleHi: av(it.titleHi || ''),
    feeInr: { N: String(feeInr) },
    gateChecked: { BOOL: !!it.gateChecked },
    regMode: av(it.regMode || 'register'),
    capacity: { N: String(Number(it.capacity) || 0) },
    updatedAt: { N: String(Math.floor(Date.now() / 1000)) },
    updatedBy: { S: 'seed' },
  };
  const args = ['dynamodb', 'put-item', '--table-name', TABLE, '--item', JSON.stringify(row), '--region', REGION];
  if (PROFILE) args.push('--profile', PROFILE);
  execFileSync('aws', args, { stdio: 'ignore' });
  n++;
}
console.log(`seeded ${n} ITEMCFG rows into ${TABLE}`);
