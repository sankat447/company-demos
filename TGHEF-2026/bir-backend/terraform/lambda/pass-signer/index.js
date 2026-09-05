/**
 * ES256 pass/badge issuer + revocation (ARCHITECTURE §6). Signs the JWTs the
 * app verifies OFFLINE against the pinned JWKS. Private key from SSM SecureString
 * at PRIVATE_KEY_PARAM; public JWKS published to the media CDN.
 * NEVER return the private key.
 */
'use strict';
const { createSign } = require('node:crypto');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

const KID = process.env.ISSUER_KID || 'bir-2026-01';
const ssm = new SSMClient({});
let cachedKey = null;

function b64url(x) {
  return Buffer.from(x).toString('base64url');
}

async function privateKeyPem() {
  if (cachedKey) return cachedKey;
  const out = await ssm.send(
    new GetParameterCommand({ Name: process.env.PRIVATE_KEY_PARAM, WithDecryption: true }),
  );
  cachedKey = out.Parameter.Value;
  return cachedKey;
}

async function signPass(claims) {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: KID }));
  const jti = claims.jti || `${claims.typ}-${claims.sub}-${claims.nbf}`;
  const payload = b64url(JSON.stringify({ ...claims, jti }));
  const signer = createSign('SHA256');
  signer.update(`${header}.${payload}`);
  const sig = signer.sign({ key: await privateKeyPem(), dsaEncoding: 'ieee-p1363' });
  return { jti, token: `${header}.${payload}.${b64url(sig)}` };
}

exports.handler = async (event) => {
  const field = event.field || (event.info && event.info.fieldName);
  // Health probe path so the deployed function is verifiable immediately.
  if (!field) return { ok: true, kid: KID };
  switch (field) {
    case 'issueBadge':
      // TODO(prod): enforce confirmed+lodging-resolved, then:
      // return signPass({ typ:'participant', sub, evt:'bir-festival-2026', ... });
      throw new Error('issueBadge: business logic pending');
    case 'issueMasterPass': {
      // The one per-user "master ticket". Minimal identity (name + age-band) so
      // the offline scanner can eyeball the holder; entitlements are resolved
      // separately (device snapshot / online). Zones ['festival'] = all-access;
      // the scanner treats a master pass as valid for any gate zone.
      const nbf = Math.floor(Date.now() / 1000);
      const exp = 1795564800; // 2026-11-24 end of festival window
      return signPass({
        typ: 'master',
        sub: event.sub,
        evt: 'bir-festival-2026',
        name: event.name || '',
        ageBand: event.ageBand || '',
        zones: ['festival'],
        jti: `master-${event.sub}-${nbf}`,
        nbf,
        exp,
      });
    }
    case 'issuePass': {
      // B5: mint the pass token(s) for a webhook-confirmed order. Called only by
      // the payment webhook (which has already re-verified the txn with Paytm).
      const nbf = Math.floor(Date.now() / 1000);
      const exp = 1795564800; // 2026-11-24 end of festival window
      const typ = event.kind === 'ticket' ? 'entry' : 'activity';
      const quantity = Math.max(1, Number(event.quantity) || 1);
      const passTokens = [];
      for (let i = 0; i < quantity; i++) {
        const { token } = await signPass({
          typ,
          sub: event.sub,
          evt: 'bir-festival-2026',
          item: event.itemId,
          ord: event.orderId,
          seq: i,
          // Every pass carries zones — the offline verifier rejects a pass without
          // them as malformed. 'festival' = general entry; the activity entitlement
          // itself is checked separately (REG snapshot), not from the pass.
          zones: ['festival'],
          jti: `${typ}-${event.orderId}-${i}`,
          nbf,
          exp,
        });
        passTokens.push(token);
      }
      return { passTokens };
    }
    default:
      throw new Error(`pass-signer: unknown field ${field}`);
  }
};

exports.signPass = signPass; // reused by the payment webhook
