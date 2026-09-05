#!/usr/bin/env node
/**
 * Seed the existing highlights catalog into CATALOG/<id> rows so console catalog
 * authoring is ADDITIVE. The admin /admin/catalog handler regenerates the CDN
 * catalog.json from these rows — without this migration the first edit would
 * replace the whole catalog with just the edited item. Run once (idempotent),
 * alongside seed-itemcfg.mjs.
 *
 * Usage: TABLE=<t> AWS_PROFILE=<p> AWS_REGION=<r> node seed-catalog.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const TABLE = process.env.TABLE;
const PROFILE = process.env.AWS_PROFILE;
const REGION = process.env.AWS_REGION ?? 'us-east-1';
if (!TABLE) throw new Error('TABLE env required');

const catalog = JSON.parse(readFileSync(new URL('../data/highlights-catalog.json', import.meta.url)));
const items = catalog.items || [];
let n = 0;
for (const it of items) {
  const row = {
    pk: { S: 'CATALOG' },
    sk: { S: it.id },
    categoryId: { S: String(it.categoryId || '') },
    title: { S: String(it.title || it.id) },
    doc: { S: JSON.stringify(it) },
    updatedAt: { N: String(Math.floor(Date.now() / 1000)) },
    updatedBy: { S: 'seed' },
  };
  const args = ['dynamodb', 'put-item', '--table-name', TABLE, '--item', JSON.stringify(row), '--region', REGION];
  if (PROFILE) args.push('--profile', PROFILE);
  execFileSync('aws', args, { stdio: 'ignore' });
  n++;
}
console.log(`seeded ${n} CATALOG rows into ${TABLE}`);
