/**
 * Minimal AWS SigV4 signer (pure node:crypto, no SDK deps) for calling the
 * AppSync GraphQL endpoint as the Lambda's IAM role. Used by the payment
 * webhook to invoke the server-only confirmOrder mutation, which fans out the
 * onOrderConfirmed subscription to the waiting app.
 */
'use strict';
const crypto = require('node:crypto');

const sha256hex = (data) => crypto.createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();

function signingKey(secret, dateStamp, region, service) {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/**
 * POST a GraphQL body to the AppSync endpoint, signed as `appsync` for the
 * current region using the Lambda role's env credentials. Returns parsed JSON.
 */
async function appsyncGraphql(endpoint, region, body) {
  const url = new URL(endpoint);
  const host = url.host;
  const payload = JSON.stringify(body);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const service = 'appsync';
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;

  const payloadHash = sha256hex(payload);
  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n` +
    (sessionToken ? `x-amz-security-token:${sessionToken}\n` : '');
  const signedHeaders =
    'content-type;host;x-amz-content-sha256;x-amz-date' + (sessionToken ? ';x-amz-security-token' : '');
  const canonicalRequest = [
    'POST',
    url.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const signature = crypto
    .createHmac('sha256', signingKey(secretKey, dateStamp, region, service))
    .update(stringToSign, 'utf8')
    .digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers = {
    'Content-Type': 'application/json',
    'X-Amz-Date': amzDate,
    'X-Amz-Content-Sha256': payloadHash,
    Authorization: authorization,
  };
  if (sessionToken) headers['X-Amz-Security-Token'] = sessionToken;

  const resp = await fetch(endpoint, { method: 'POST', headers, body: payload });
  return resp.json();
}

module.exports = { appsyncGraphql };
