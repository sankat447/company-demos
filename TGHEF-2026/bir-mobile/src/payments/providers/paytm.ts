import type { CheckoutOutcome, PaymentOrder, PaymentProvider } from '../provider';

/**
 * Paytm All-in-One checkout (B5) — presents UPI, cards, netbanking and wallet
 * from one sheet (the modes come from Paytm, not the app). The result is a
 * CLIENT-SIDE signal only: 'submitted' still requires the backend webhook
 * confirmation (onOrderConfirmed) before any pass exists — the payment is NEVER
 * asserted from the SDK callback (ARCHITECTURE §5).
 *
 * The SDK is a native module, loaded lazily so Jest and any non-checkout bundle
 * path never touch it. The merchant KEY never reaches the client — the backend
 * signs the Initiate Transaction and hands back only the txnToken (providerOrderRef).
 */
interface AllInOneSDK {
  startTransaction(
    orderId: string,
    mid: string,
    txnToken: string,
    amount: string,
    callbackUrl: string,
    isStaging: boolean,
    restrictAppInvoke: boolean,
    urlScheme: string,
  ): Promise<Record<string, unknown>>;
}

/**
 * Map the SDK's (advisory) result to a CheckoutOutcome. An explicit cancel is a
 * cancel; anything else is 'submitted' — the webhook has the final say. Kept
 * pure (no native import) so it is unit-testable.
 */
export function paytmResultToOutcome(result: Record<string, unknown> | null): CheckoutOutcome {
  const msg = String(result?.RESPMSG ?? result?.STATUS ?? result?.message ?? '');
  return { state: /cancel/i.test(msg) ? 'cancelled' : 'submitted' };
}

export const paytmProvider: PaymentProvider = {
  name: 'paytm',
  async openCheckout(
    order: PaymentOrder,
    _opts: { phone: string; locale: string },
  ): Promise<CheckoutOutcome> {
    if (!order.mid || !order.callbackUrl) {
      throw new Error('order response missing Paytm mid/callbackUrl — check payments contract');
    }
    const mod = (await import('paytm_allinone_react-native')) as unknown as {
      default: AllInOneSDK;
    };
    try {
      const result = await mod.default.startTransaction(
        order.orderId,
        order.mid,
        order.providerOrderRef, // txnToken
        order.amountInr.toFixed(2),
        order.callbackUrl,
        order.environment !== 'prod', // isStaging
        false, // restrictAppInvoke=false → allow native UPI-app handoff (best UPI UX)
        'bir', // iOS return url scheme (app.config scheme)
      );
      return paytmResultToOutcome(result);
    } catch (err) {
      const m = String((err as { message?: string }).message ?? '');
      return { state: /cancel/i.test(m) ? 'cancelled' : 'failed' };
    }
  },
};
