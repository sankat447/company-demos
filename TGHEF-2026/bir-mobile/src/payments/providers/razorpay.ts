import { palette } from '@/ui/tokens';

import type { CheckoutOutcome, PaymentOrder, PaymentProvider } from '../provider';

/**
 * Razorpay UPI-intent checkout (P3.1). The sheet result is a CLIENT-SIDE
 * signal only — 'submitted' still requires the backend webhook confirmation
 * (onOrderConfirmed) before any pass exists. Never mocked in production paths.
 *
 * The SDK is loaded lazily: it is a native module, absent in Jest and in any
 * bundle path that never reaches checkout.
 */
export const razorpayProvider: PaymentProvider = {
  name: 'razorpay',
  async openCheckout(
    order: PaymentOrder,
    opts: { phone: string; locale: string },
  ): Promise<CheckoutOutcome> {
    if (!order.providerKeyId) {
      throw new Error('order response missing providerKeyId — see docs/BACKEND_ASKS.md #14');
    }
    const { default: RazorpayCheckout } = await import('react-native-razorpay');
    try {
      await RazorpayCheckout.open({
        key: order.providerKeyId,
        order_id: order.providerOrderRef,
        amount: Math.round(order.amountInr * 100), // paise; display only — the order is authoritative
        currency: 'INR',
        name: 'Bir Festival 2026',
        prefill: { contact: opts.phone },
        theme: { color: palette.pine },
      });
      return { state: 'submitted' };
    } catch (err) {
      // Razorpay rejects with {code, description}; code differs per OS for
      // user-cancel, so match on the description conservatively.
      const description = String((err as { description?: string }).description ?? '');
      return { state: /cancel/i.test(description) ? 'cancelled' : 'failed' };
    }
  },
};
