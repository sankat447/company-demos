/**
 * B2c: issueBadge — admin-hospitality guarded. Signs a participant badge
 * (typ:'participant') as an ES256 JWT with the same issuer key as the passes,
 * so the OFFLINE gate verifier accepts it unchanged. Returns { jti, passToken }.
 * The private key never leaves SSM/this function.
 */
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { createSign } = require('node:crypto');

const ddb = new DynamoDBClient({});
const ssm = new SSMClient({});
const TABLE = process.env.TABLE;
const KID = process.env.ISSUER_KID;
const KEY_PARAM = process.env.PRIVATE_KEY_PARAM;

let cachedKey;
async function privateKey() {
  if (cachedKey) return cachedKey;
  const res = await ssm.send(new GetParameterCommand({ Name: KEY_PARAM, WithDecryption: true }));
  cachedKey = res.Parameter.Value;
  return cachedKey;
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function sign(claims, pem) {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: KID, typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const signer = createSign('SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  const sig = signer.sign({ key: pem, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64url(sig)}`;
}

exports.handler = async (event) => {
  const identity = event.identity || {};
  const isIam = Boolean(identity.userArn || identity.accountId);
  const groups = identity.groups || (identity.claims && identity.claims['cognito:groups']) || [];
  if (!isIam && !groups.includes('admin-hospitality')) {
    throw new Error('Unauthorized: admin-hospitality required');
  }
  const input = (event.arguments && event.arguments.input) || {};
  const regId = input.regId;
  if (!regId) throw new Error('regId required');

  const res = await ddb.send(
    new GetItemCommand({ TableName: TABLE, Key: { pk: { S: 'REG' }, sk: { S: regId } } }),
  );
  const participant = res.Item ? unmarshall(res.Item) : {};
  const competition = participant.competitionId || regId.split(':')[2] || '';

  const nowSec = Math.floor(Date.now() / 1000);
  const claims = {
    jti: `badge-${regId}`,
    typ: 'participant',
    sub: regId,
    evt: 'bir-festival-2026',
    competition,
    zones: ['participant'],
    nbf: nowSec - 3600,
    exp: Math.floor(new Date('2026-12-01T00:00:00+05:30').getTime() / 1000),
  };
  const passToken = sign(claims, await privateKey());
  return { jti: claims.jti, passToken };
};
