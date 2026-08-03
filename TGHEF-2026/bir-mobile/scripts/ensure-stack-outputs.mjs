#!/usr/bin/env node
/**
 * Dev convenience (postinstall): if config/stack-outputs.json is absent,
 * copy the example so Metro can resolve the static import. The pipeline
 * replaces this file with real CloudFormation/CDK outputs before building.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const real = join(root, 'config/stack-outputs.json');
const example = join(root, 'config/stack-outputs.example.json');

if (!existsSync(real)) {
  copyFileSync(example, real);
  console.warn(
    '⚠ config/stack-outputs.json created from EXAMPLE values. ' +
      'Replace with real stack exports before pointing at a live environment.',
  );
}
