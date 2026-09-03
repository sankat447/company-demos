/**
 * B5: the Paytm provider maps the native SDK result onto the CheckoutOutcome.
 * The mapping is pure (paytmResultToOutcome) so it is testable without the
 * native SDK (which openCheckout imports lazily). Invariant: the result is
 * advisory — only an explicit cancel is 'cancelled'; success / anything else is
 * 'submitted' (the webhook has the final say).
 */
import { paytmProvider, paytmResultToOutcome } from '@/payments/providers/paytm';
import type { PaymentOrder } from '@/payments/provider';

describe('paytmResultToOutcome (advisory mapping)', () => {
  it('maps a successful sheet to submitted', () => {
    expect(paytmResultToOutcome({ STATUS: 'TXN_SUCCESS', RESPMSG: 'Txn Success' })).toEqual({
      state: 'submitted',
    });
  });
  it('maps an explicit cancel to cancelled', () => {
    expect(paytmResultToOutcome({ RESPMSG: 'Transaction Cancelled' })).toEqual({
      state: 'cancelled',
    });
  });
  it('an empty / unknown result is still submitted (webhook decides)', () => {
    expect(paytmResultToOutcome(null)).toEqual({ state: 'submitted' });
  });
});

describe('paytmProvider.openCheckout guards', () => {
  const order: PaymentOrder = {
    orderId: 'ord-1',
    providerOrderRef: 'txn-token-xyz',
    amountInr: 499,
    mid: 'MID123',
    environment: 'staging',
    callbackUrl: 'https://api/v1/pay/webhook',
  };

  it('rejects before touching the SDK when mid/callbackUrl are missing', async () => {
    await expect(
      paytmProvider.openCheckout({ ...order, mid: undefined }, { phone: '+910', locale: 'en' }),
    ).rejects.toThrow(/mid/);
  });
});
