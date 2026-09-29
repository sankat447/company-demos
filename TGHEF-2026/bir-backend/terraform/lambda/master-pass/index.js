/**
 * Master ticket issuance (Cognito-authorized). GET /pass/master returns the
 * caller's single master pass — a minimal-identity ES256 token (name +
 * age-band + Pass ID) the app shows as one QR and the scanner verifies offline.
 * Mint-if-absent: an unexpired pass is returned as-is; ?refresh=1 forces a
 * re-mint (e.g. after the profile changes). Requires a completed, DPDP-
 * consented profile (name + DOB). @aws-sdk clients ship in the runtime.
 */
'use strict';
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { DynamoDBClient, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');

const ddb = new DynamoDBClient({});
const lambda = new LambdaClient({});
const TABLE = process.env.TABLE;
const SIGNER_FN = process.env.SIGNER_FN;

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

/** Age band from a YYYY-MM-DD DOB — only the band ever leaves in the QR. */
function ageBandFromDob(dob) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob || ''));
  if (!m) return '';
  const [, y, mo, d] = m.map(Number);
  const now = new Date();
  let age = now.getUTCFullYear() - y;
  const md = (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
  if (md < mo * 100 + d) age -= 1;
  if (age < 0 || age > 130) return '';
  if (age < 13) return 'child';
  if (age < 18) return 'minor';
  return 'adult';
}

async function getItem(pk, sk) {
  const r = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: { pk: { S: pk }, sk: { S: sk } } }));
  return r.Item || null;
}

exports.handler = async (event) => {
  const claims =
    (event.requestContext && event.requestContext.authorizer && event.requestContext.authorizer.jwt &&
      event.requestContext.authorizer.jwt.claims) || {};
  const sub = claims.sub;
  if (!sub) return json(401, { error: 'unauthenticated' });
  const refresh = event.queryStringParameters && event.queryStringParameters.refresh === '1';

  const profile = await getItem(`PROFILE#${sub}`, 'PROFILE');
  const name = profile && profile.displayName && profile.displayName.S;
  const dob = profile && profile.dob && profile.dob.S;
  const consent = profile && profile.consentDpdp && profile.consentDpdp.BOOL;
  if (!name || !dob || !consent) {
    return json(428, { error: 'profile incomplete', detail: 'Add your name and date of birth (with consent) first.' });
  }
  const ageBand = ageBandFromDob(dob);
  const nowSec = Math.floor(Date.now() / 1000);

  // Return an existing, unexpired pass unless a refresh is requested.
  if (!refresh) {
    const existing = await getItem(`MASTERPASS#${sub}`, 'MASTER');
    if (existing && existing.token && existing.exp && Number(existing.exp.N) > nowSec + 60) {
      return json(200, {
        token: existing.token.S, jti: existing.jti.S,
        name, ageBand, passId: existing.passId ? existing.passId.S : existing.jti.S,
      });
    }
  }

  // Mint a fresh master pass via the ES256 signer.
  const out = await lambda.send(new InvokeCommand({
    FunctionName: SIGNER_FN,
    Payload: Buffer.from(JSON.stringify({ field: 'issueMasterPass', sub, name, ageBand })),
  }));
  const signed = JSON.parse(Buffer.from(out.Payload).toString() || '{}');
  if (!signed.token) return json(502, { error: 'could not mint master pass', detail: signed.errorMessage || '' });

  const exp = 1795564800; // festival window end
  const passId = 'PASS-' + signed.jti.slice(-8).toUpperCase();
  await ddb.send(new PutItemCommand({
    TableName: TABLE,
    Item: {
      pk: { S: `MASTERPASS#${sub}` }, sk: { S: 'MASTER' },
      jti: { S: signed.jti }, token: { S: signed.token }, passId: { S: passId },
      ageBand: { S: ageBand }, issuedAt: { N: String(nowSec) }, exp: { N: String(exp) },
    },
  }));
  return json(200, { token: signed.token, jti: signed.jti, name, ageBand, passId });
};
