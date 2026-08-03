#!/usr/bin/env node
/**
 * CI gate: hi.json must have 100% key parity with en.json (CLAUDE.md rule 3).
 * Compares deep key sets both directions and rejects empty Hindi values.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const en = JSON.parse(readFileSync(join(root, 'src/i18n/en.json'), 'utf8'));
const hi = JSON.parse(readFileSync(join(root, 'src/i18n/hi.json'), 'utf8'));

function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]],
  );
}

const enKeys = new Map(flatten(en));
const hiKeys = new Map(flatten(hi));

const missing = [...enKeys.keys()].filter((k) => !hiKeys.has(k));
const extra = [...hiKeys.keys()].filter((k) => !enKeys.has(k));
const empty = [...hiKeys.entries()].filter(([, v]) => String(v).trim() === '').map(([k]) => k);

if (missing.length || extra.length || empty.length) {
  if (missing.length) console.error('✘ missing in hi.json:', missing.join(', '));
  if (extra.length) console.error('✘ extra in hi.json:', extra.join(', '));
  if (empty.length) console.error('✘ empty Hindi values:', empty.join(', '));
  process.exit(1);
}
console.log(`✔ hi.json parity OK (${enKeys.size} keys)`);
