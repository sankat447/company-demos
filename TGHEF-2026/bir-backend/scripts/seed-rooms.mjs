#!/usr/bin/env node
/**
 * Seed the room inventory into DynamoDB as ROOM/<id> items, so the
 * commit-allocation Lambda can re-validate §3 against source-of-truth rooms.
 * Pure node (no aws-sdk locally): marshals + shells out to the AWS CLI.
 *
 * Usage: TABLE=<t> AWS_PROFILE=<p> AWS_REGION=<r> node seed-rooms.mjs
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
  if (Array.isArray(v)) return { L: v.map(av) };
  if (v && typeof v === 'object') {
    return { M: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, av(x)])) };
  }
  return { NULL: true };
}

const rooms = JSON.parse(readFileSync(new URL('../data/rooms.json', import.meta.url)));
for (const room of rooms) {
  const item = { pk: { S: 'ROOM' }, sk: { S: room.id }, ...Object.fromEntries(
    Object.entries(room).map(([k, x]) => [k, av(x)]),
  ) };
  const args = ['dynamodb', 'put-item', '--table-name', TABLE, '--item', JSON.stringify(item),
    '--region', REGION];
  if (PROFILE) args.push('--profile', PROFILE);
  execFileSync('aws', args, { stdio: 'ignore' });
}
console.log(`seeded ${rooms.length} rooms into ${TABLE}`);
