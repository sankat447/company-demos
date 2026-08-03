#!/usr/bin/env node
/**
 * Validates config/stack-outputs.json (and always the checked-in example)
 * against schemas/stack-contract.schema.json.
 * Exit non-zero on any violation — wired into CI and `npm run contract:check`.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(root, 'schemas/stack-contract.schema.json'), 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

let failed = false;
const targets = [join(root, 'config/stack-outputs.example.json')];
const real = join(root, 'config/stack-outputs.json');
if (existsSync(real)) targets.push(real);
else console.warn('⚠ config/stack-outputs.json not found — validated example only.');

for (const file of targets) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (validate(data)) {
    console.log(`✔ ${file.replace(root + '/', '')} conforms to stack contract`);
  } else {
    failed = true;
    console.error(`✘ ${file.replace(root + '/', '')} violates the stack contract:`);
    for (const err of validate.errors ?? []) {
      console.error(`  ${err.instancePath || '/'} ${err.message}`);
    }
  }
}
process.exit(failed ? 1 : 0);
