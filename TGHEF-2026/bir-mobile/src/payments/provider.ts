/**
 * Payment provider seam (CLAUDE.md fixed decision): UPI intent flow behind
 * this interface; the concrete provider is injected per the contract's
 * payments.provider flag. Success is NEVER asserted from the client
 * callback — the backend webhook confirms via the onOrderConfirmed
 * subscription (ARCHITECTURE.md §5), which callers await separately.
 */
import { restPost } from '@/api/rest';
import { getStack } from '@/config/stack';

import { razorpayProvider } from './providers/razorpay';

export interface PaymentOrder {
  orderId: string;
  /** Provider-side token/order reference handed to the checkout SDK. */
  providerOrderRef: string;
  amountInr: number;
}

export interface CheckoutOutcome {
  /** Client-side signal only — 'submitted' still requires webhook confirmation. */
  state: 'submitted' | 'cancelled' | 'failed';
}

export interface PaymentProvider {
  readonly name: 'razorpay' | 'cashfree';
  openCheckout(
    order: PaymentOrder,
    opts: { phone: string; locale: string },
  ): Promise<CheckoutOutcome>;
}

/** Create the order server-side; the app never computes amounts. */
export async function createOrder(input: {
  kind: 'ticket' | 'experience';
  itemId: string;
  quantity: number;
  idempotencyKey: string;
}): Promise<PaymentOrder> {
  return restPost<PaymentOrder>(getStack().payments.orderPath, input);
}

export function getPaymentProvider(): PaymentProvider {
  const which = getStack().payments.provider;
  if (which === 'razorpay') return razorpayProvider;
  throw new Error(`payment provider not implemented: ${which} — see docs/BACKEND_ASKS.md`);
}
