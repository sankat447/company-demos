/**
 * Payment provider seam (CLAUDE.md fixed decision): UPI intent flow behind
 * this interface; the concrete provider is injected per the contract's
 * payments.provider flag. Success is NEVER asserted from the client
 * callback — the backend webhook confirms via the onOrderConfirmed
 * subscription (ARCHITECTURE.md §5), which callers await separately.
 */
import { restPost } from '@/api/rest';
import { getStack } from '@/config/stack';

import { paytmProvider } from './providers/paytm';
import { razorpayProvider } from './providers/razorpay';

export interface PaymentOrder {
  orderId: string;
  /** Provider-side token/order reference handed to the checkout SDK
   *  (Paytm: the txnToken; Razorpay: the order id). */
  providerOrderRef: string;
  amountInr: number;
  /** Razorpay public key id for the checkout sheet (BACKEND_ASKS #14). */
  providerKeyId?: string;
  /** Paytm merchant id (public; the merchant KEY never leaves the backend). */
  mid?: string;
  /** Paytm gateway environment for the SDK (staging vs prod). */
  environment?: 'staging' | 'prod';
  /** Server-to-server callback the SDK reports completion to. */
  callbackUrl?: string;
}

export interface CheckoutOutcome {
  /** Client-side signal only — 'submitted' still requires webhook confirmation. */
  state: 'submitted' | 'cancelled' | 'failed';
}

export interface PaymentProvider {
  readonly name: 'razorpay' | 'cashfree' | 'paytm';
  openCheckout(
    order: PaymentOrder,
    opts: { phone: string; locale: string },
  ): Promise<CheckoutOutcome>;
}

/** Create the order server-side; the app never computes amounts. */
export async function createOrder(input: {
  kind: 'ticket' | 'experience' | 'registration';
  itemId: string;
  quantity: number;
  idempotencyKey: string;
}): Promise<PaymentOrder> {
  return restPost<PaymentOrder>(getStack().payments.orderPath, input);
}

export function getPaymentProvider(): PaymentProvider {
  const which = getStack().payments.provider;
  if (which === 'paytm') return paytmProvider;
  if (which === 'razorpay') return razorpayProvider;
  throw new Error(`payment provider not implemented: ${which} — see docs/BACKEND_ASKS.md`);
}
