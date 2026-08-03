import type { CheckoutOutcome, PaymentOrder, PaymentProvider } from '../provider';

/**
 * Razorpay UPI-intent checkout. The native SDK (react-native-razorpay) is a
 * Phase 3 dependency (P3.1) — added then, per bundle-discipline rule 7.
 * Until wired, opening checkout fails loudly rather than faking success:
 * payments must never be mocked in production paths (CLAUDE.md "when unsure").
 */
export const razorpayProvider: PaymentProvider = {
  name: 'razorpay',
  async openCheckout(_order: PaymentOrder): Promise<CheckoutOutcome> {
    throw new Error('P3.1 pending: react-native-razorpay checkout not yet wired');
  },
};
