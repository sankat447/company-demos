/**
 * B5: createOrder — the server is the ONLY amount authority (ARCHITECTURE §5).
 * Prices the item server-side, writes a PENDING ORDER row (idempotent on the
 * app's idempotencyKey), then calls Paytm's Initiate Transaction API (signed
 * with the merchant key, which never leaves the backend) and returns the
 * txnToken the app hands to the Paytm All-in-One SDK. Payment success is NEVER
 * asserted here — only the webhook confirms.
 */
'use strict';
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

const { generateSignature } = require('./paytm');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ssm = new SSMClient({});
const TABLE = process.env.TABLE;
const ENV = process.env.PAYTM_ENV === 'prod' ? 'prod' : 'staging';
const HOST = ENV === 'prod' ? 'securegw.paytm.in' : 'securegw-stage.paytm.in';
// Overridable: some test MIDs use a merchant-specific website name rather than
// the Paytm defaults (WEBSTAGING / DEFAULT).
const WEBSITE = process.env.PAYTM_WEBSITE || (ENV === 'prod' ? 'DEFAULT' : 'WEBSTAGING');

let creds = null;
async function paytmCreds() {
  if (creds) return creds;
  const [mid, key] = await Promise.all([
    ssm
      .send(new GetParameterCommand({ Name: process.env.PAYTM_MID_PARAM }))
      .then((o) => o.Parameter.Value.trim()),
    ssm
      .send(new GetParameterCommand({ Name: process.env.PAYTM_KEY_PARAM, WithDecryption: true }))
      .then((o) => o.Parameter.Value.trim()),
  ]);
  creds = { mid, key };
  return creds;
}

/** Server-side price (paise-free INR). Never trusts a client amount.
 *   ticket            → TIER.priceInr
 *   registration/activity → ITEMCFG.feeInr (the same row the entitlement gate reads)
 *   anything else     → PRICE#<kind>#<itemId>.priceInr
 * Returns null for a missing/zero price → caller 422s (a free item has no order). */
async function priceInr(kind, itemId) {
  let key;
  let field = 'priceInr';
  if (kind === 'ticket') {
    key = { pk: 'TIER', sk: itemId };
  } else if (kind === 'registration' || kind === 'activity') {
    key = { pk: 'ITEMCFG', sk: itemId };
    field = 'feeInr';
  } else {
    key = { pk: 'PRICE', sk: `${kind}#${itemId}` };
  }
  const out = await ddb.send(new GetCommand({ TableName: TABLE, Key: key }));
  const p = out.Item && Number(out.Item[field]);
  return Number.isFinite(p) && p > 0 ? p : null;
}

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  // Cognito JWT authorizer (HTTP API) puts the verified claims here.
  const claims =
    (event.requestContext &&
      event.requestContext.authorizer &&
      event.requestContext.authorizer.jwt &&
      event.requestContext.authorizer.jwt.claims) ||
    {};
  const sub = claims.sub;
  if (!sub) return json(401, { error: 'unauthenticated' });

  let input;
  try {
    input = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'bad json' });
  }
  const { kind, itemId, quantity, idempotencyKey, slotId } = input;
  if (!kind || !itemId || !idempotencyKey) return json(400, { error: 'kind, itemId, idempotencyKey required' });
  const qty = Math.max(1, Number(quantity) || 1);

  // If this order already confirmed, don't re-charge — hand the app back its state.
  const existing = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: 'ORDER', sk: idempotencyKey } }),
  );
  if (existing.Item && existing.Item.status === 'CONFIRMED') {
    return json(200, { orderId: idempotencyKey, alreadyConfirmed: true, amountInr: existing.Item.amountInr });
  }

  const unit = await priceInr(kind, itemId);
  if (unit === null) return json(422, { error: `no server price for ${kind}:${itemId}` });
  const amountInr = unit * qty;
  const orderId = idempotencyKey;

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: 'ORDER',
        sk: orderId,
        orderId,
        sub,
        kind,
        itemId,
        slotId: slotId || 'na',
        quantity: qty,
        amountInr,
        status: 'PENDING',
        provider: 'paytm',
        createdAt: Math.floor(Date.now() / 1000),
      },
    }),
  );

  const { mid, key } = await paytmCreds();
  if (!mid || !key || mid.startsWith('REPLACE')) {
    return json(503, { error: 'paytm credentials not provisioned — set the SSM params (see docs/BACKEND_ASKS.md)' });
  }

  const callbackUrl = process.env.CALLBACK_URL;
  // Paytm custId must be a clean alphanumeric id — the Cognito sub is a
  // hyphenated UUID, which Paytm rejects (generic 501). Strip to alphanumerics.
  const custId = sub.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40) || 'guest';
  const body = {
    requestType: 'Payment',
    mid,
    websiteName: WEBSITE,
    orderId,
    callbackUrl,
    txnAmount: { value: amountInr.toFixed(2), currency: 'INR' },
    userInfo: { custId },
  };
  const signature = generateSignature(JSON.stringify(body), key);
  const url = `https://${HOST}/theia/api/v1/initiateTransaction?mid=${mid}&orderId=${orderId}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, head: { signature } }),
  });
  const data = await resp.json();
  const txnToken = data && data.body && data.body.txnToken;
  if (!txnToken) {
    const info = data && data.body && data.body.resultInfo;
    console.log('paytm initiate failed:', JSON.stringify(info), 'mid:', mid, 'website:', WEBSITE);
    return json(502, { error: 'paytm initiate failed', detail: info });
  }

  return json(200, {
    orderId,
    providerOrderRef: txnToken,
    amountInr,
    mid,
    environment: ENV,
    callbackUrl,
  });
};
