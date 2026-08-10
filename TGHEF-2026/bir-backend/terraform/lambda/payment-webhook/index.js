/**
 * Razorpay payment webhook (ARCHITECTURE §5) — the ONLY payment authority.
 * Verifies the HMAC signature, then (TODO) marks the order CONFIRMED and mints
 * pass tokens so onOrderConfirmed delivers them. The app never self-confirms.
 */
'use strict';
const { createHmac, timingSafeEqual } = require('node:crypto');

function verify(body, signature, secret) {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

exports.handler = async (event) => {
  // Function URL / API GW proxy shape.
  const body = event.body || '';
  const sig = (event.headers && (event.headers['x-razorpay-signature'] || event.headers['X-Razorpay-Signature'])) || '';
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';

  if (!body) return { statusCode: 200, body: JSON.stringify({ ok: true, note: 'health' }) };
  if (!verify(body, sig, secret)) return { statusCode: 400, body: 'invalid signature' };

  // TODO(prod): parse order_id, mark CONFIRMED (idempotent), invoke pass-signer,
  // write passTokens onto the order row for onOrderConfirmed.
  return { statusCode: 200, body: 'ok' };
};
