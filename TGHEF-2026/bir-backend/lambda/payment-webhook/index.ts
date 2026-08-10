/**
 * Razorpay payment webhook (ARCHITECTURE §5). The ONLY authority that
 * confirms a payment — the app never self-confirms. On a verified webhook:
 *   1. verify the Razorpay HMAC signature (reject otherwise),
 *   2. mark the order CONFIRMED in DynamoDB,
 *   3. invoke pass-signer to mint the pass token(s),
 *   4. publish onOrderConfirmed so the waiting app receives passTokens.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

interface WebhookEvent {
  body: string;
  headers: Record<string, string>;
}

function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handler(event: WebhookEvent) {
  // TODO(backend): read RAZORPAY_WEBHOOK_SECRET from SSM.
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';
  const signature = event.headers['x-razorpay-signature'] ?? '';

  if (!verifySignature(event.body, signature, secret)) {
    return { statusCode: 400, body: 'invalid signature' };
  }

  // TODO(backend):
  //   const { order_id } = JSON.parse(event.body).payload.payment.entity;
  //   mark order CONFIRMED (idempotent on order_id),
  //   invoke pass-signer for the ticket/activity pass,
  //   write passTokens onto the order so onOrderConfirmed delivers them.
  return { statusCode: 200, body: 'ok' };
}
