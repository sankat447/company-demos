#!/usr/bin/env node
// Derive a public JWKS (single P-256 key) from a private EC PEM.
// Usage: node jwks-from-pem.mjs <priv.pem> <kid>
import { readFileSync } from 'node:fs';
import { createPublicKey } from 'node:crypto';

const [, , pemPath, kid] = process.argv;
if (!pemPath || !kid) {
  console.error('usage: jwks-from-pem.mjs <priv.pem> <kid>');
  process.exit(1);
}
const jwk = createPublicKey(readFileSync(pemPath)).export({ format: 'jwk' });
process.stdout.write(
  JSON.stringify({ keys: [{ kty: 'EC', crv: 'P-256', kid, x: jwk.x, y: jwk.y, use: 'sig', alg: 'ES256' }] }, null, 2) + '\n',
);
