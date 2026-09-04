/**
 * B5: Paytm payment callback — the ONLY payment authority (ARCHITECTURE §5).
 * Verifies the Paytm checksum, RE-checks the transaction with Paytm's Order
 * Status API (never trusts the callback alone), then on success mints the pass
 * tokens (pass-signer) and invokes the server-only confirmOrder mutation, which
 * fans out onOrderConfirmed to the waiting app. The app never self-confirms.
 * Finally redirects the browser back into the app via a deep link.
 */
'use strict';
const querystring = require('node:querystring');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const { generateSignature, verifySignature, paramsToString } = require('./paytm');
const { appsyncGraphql } = require('./sigv4');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ssm = new SSMClient({});
const lambda = new LambdaClient({});
const TABLE = process.env.TABLE;
const REGION = process.env.AWS_REGION;
const ENV = process.env.PAYTM_ENV === 'prod' ? 'prod' : 'staging';
const HOST = ENV === 'prod' ? 'securegw.paytm.in' : 'securegw-stage.paytm.in';

let creds = null;
async function paytmCreds() {
  if (creds) return creds;
  const [mid, key] = await Promise.all([
    ssm.send(new GetParameterCommand({ Name: process.env.PAYTM_MID_PARAM })).then((o) => o.Parameter.Value.trim()),
    ssm
      .send(new GetParameterCommand({ Name: process.env.PAYTM_KEY_PARAM, WithDecryption: true }))
      .then((o) => o.Parameter.Value.trim()),
  ]);
  creds = { mid, key };
  return creds;
}

/** Paytm Order Status API — authoritative txn state. */
async function orderStatus(mid, key, orderId) {
  const body = { mid, orderId };
  const signature = generateSignature(JSON.stringify(body), key);
  const resp = await fetch(`https://${HOST}/v3/order/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, head: { signature } }),
  });
  const data = await resp.json();
  return (data && data.body) || {};
}

function redirect(orderId, status) {
  const base = process.env.APP_RETURN_URL || 'bir://pay/return';
  return {
    statusCode: 302,
    headers: { Location: `${base}?orderId=${encodeURIComponent(orderId || '')}&status=${status}` },
    body: '',
  };
}

exports.handler = async (event) => {
  const raw = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body
    : '';
  if (!raw) return { statusCode: 200, body: JSON.stringify({ ok: true, note: 'health' }) };

  // Paytm posts application/x-www-form-urlencoded from the browser.
  const params = querystring.parse(raw);
  const orderId = params.ORDERID;
  const { mid, key } = await paytmCreds();
  if (!mid || !key || mid.startsWith('REPLACE')) return redirect(orderId, 'unconfigured');

  // 1. Verify the callback checksum.
  if (!verifySignature(paramsToString(params), key, params.CHECKSUMHASH)) {
    return redirect(orderId, 'bad_checksum');
  }
  // 2. RE-verify authoritatively with Paytm (never trust the callback alone).
  const st = await orderStatus(mid, key, orderId);
  if (st.resultInfo && st.resultInfo.resultStatus === 'TXN_SUCCESS') {
    const order = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'ORDER', sk: orderId } }));
    if (!order.Item) return redirect(orderId, 'unknown_order');
    if (order.Item.status !== 'CONFIRMED') {
      // 3. Mint the signed pass token(s).
      const signed = await lambda.send(
        new InvokeCommand({
          FunctionName: process.env.PASS_SIGNER_FN,
          Payload: Buffer.from(
            JSON.stringify({
              field: 'issuePass',
              sub: order.Item.sub,
              kind: order.Item.kind,
              itemId: order.Item.itemId,
              orderId,
              quantity: order.Item.quantity || 1,
            }),
          ),
        }),
      );
      const out = JSON.parse(Buffer.from(signed.Payload).toString('utf8'));
      const passTokens = (out && out.passTokens) || [];
      // 4. Fan out via confirmOrder (triggers onOrderConfirmed).
      await appsyncGraphql(process.env.APPSYNC_ENDPOINT, REGION, {
        query:
          'mutation C($orderId: ID!, $status: String!, $passTokens: [String!]) { confirmOrder(orderId: $orderId, status: $status, passTokens: $passTokens) { orderId status } }',
        variables: { orderId, status: 'CONFIRMED', passTokens },
      });
      // 5. For a PAID activity, payment is what earns the entitlement — write the
      // confirmed REG row the gate scanner reads (server-authoritative, same key
      // shape as the free path). Tickets are entry passes, not activity REGs.
      if (order.Item.kind === 'registration' || order.Item.kind === 'activity') {
        const sk = `reg:${order.Item.sub}:${order.Item.itemId}:${order.Item.slotId || 'na'}`;
        await ddb.send(
          new PutCommand({
            TableName: TABLE,
            Item: {
              pk: 'REG', sk, registrationId: sk,
              sub: order.Item.sub, itemId: order.Item.itemId, slotId: order.Item.slotId || 'na',
              status: 'confirmed', source: 'paid', orderId,
              createdAt: Math.floor(Date.now() / 1000),
            },
          }),
        );
      }
    }
    return redirect(orderId, 'success');
  }
  return redirect(orderId, 'failed');
};
