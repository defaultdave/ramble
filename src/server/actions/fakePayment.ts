'use server';

import { isRefusalCode, type FakeConfirmResult } from '@/lib/fakePayment';
import {
  FakeConfirmInputSchema,
  fakeConfirmResult,
} from '@/lib/fakePaymentInput';
import { PaymentsError } from '@/server/ports/payments';
import { getFakePayments } from '@/server/ports/payments/gateway';
import { secureEqual } from '@/server/secureEqual';

const refused: FakeConfirmResult = { status: 'refused' };

// TODO(U-047b): first caller, the checkout page's payment island.
/**
 * The confirm step of the fake gateway: records what the guest did in the fake card form
 * (paid, was declined, or was sent to 3-D Secure) as the provider would, and emits its event.
 * The client secret is the capability; an unknown payment, a wrong secret, and a payment that
 * cannot take another try all answer `refused`. Any other failure is thrown, so the form treats
 * the answer as lost and the guest is told to wait rather than to pay again.
 */
export async function confirmFakePayment(
  input: unknown,
): Promise<FakeConfirmResult> {
  const { paymentId, clientSecret, plan } = FakeConfirmInputSchema.parse(input);
  const fake = getFakePayments();
  try {
    const payment = await fake.retrieve({ kind: 'payment', id: paymentId });
    if (!payment || !secureEqual(payment.clientSecret, clientSecret)) {
      return refused;
    }
    await fake.confirm(payment.id, plan);
    return fakeConfirmResult(plan);
  } catch (error) {
    if (error instanceof PaymentsError && isRefusalCode(error.code)) {
      return refused;
    }
    throw error;
  }
}
