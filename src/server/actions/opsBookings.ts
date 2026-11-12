'use server';

import { redirect } from 'next/navigation';
import {
  cancelNoticeCode,
  opsBookingPath,
  opsBookingsPath,
  parseExpectedRefundForm,
  refundNoticeCode,
  resendNoticeCode,
  voidNoticeCode,
  type OpsNoticeCode,
} from '@/lib/opsBookings';
import { noticeHref } from '@/lib/opsForm';
import {
  cancelBookingAsOps,
  refundBookingAsOps,
  resendBookingConfirmation,
  voidBookingLinks,
} from '@/server/db/opsBookings';
import { retryFailedRefund } from '@/server/db/orderRefundRetry';
import { idOrLeave, opsCallerOrLeave } from '@/server/opsAccess';

// Each action sends ops back to the booking it acted on, with the answer as a notice. A form that
// carries no booking id goes back to the list.

const orderIdOrLeave = (formData: FormData) =>
  idOrLeave(formData, 'orderId', opsBookingsPath);

function backToBooking(orderId: string, code: OpsNoticeCode): never {
  return redirect(noticeHref(opsBookingPath(orderId), code));
}

export async function cancelBookingAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(opsBookingsPath);
  const orderId = orderIdOrLeave(formData);
  const form = parseExpectedRefundForm((name) => formData.get(name));
  if (!form.ok) return backToBooking(orderId, 'invalid');
  return backToBooking(
    orderId,
    cancelNoticeCode(
      await cancelBookingAsOps(caller, {
        orderId,
        expectedRefundMinor: form.expectedRefundMinor,
      }),
    ),
  );
}

export async function refundBookingAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(opsBookingsPath);
  const orderId = orderIdOrLeave(formData);
  const form = parseExpectedRefundForm((name) => formData.get(name));
  if (!form.ok) return backToBooking(orderId, 'invalid');
  return backToBooking(
    orderId,
    refundNoticeCode(
      await refundBookingAsOps(caller, {
        orderId,
        expectedRefundMinor: form.expectedRefundMinor,
      }),
    ),
  );
}

export async function retryRefundAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(opsBookingsPath);
  const orderId = orderIdOrLeave(formData);
  return backToBooking(
    orderId,
    refundNoticeCode(await retryFailedRefund(caller, orderId)),
  );
}

export async function resendConfirmationAction(
  formData: FormData,
): Promise<void> {
  const caller = await opsCallerOrLeave(opsBookingsPath);
  const orderId = orderIdOrLeave(formData);
  const resendId = idOrLeave(formData, 'resendId', opsBookingPath(orderId));
  return backToBooking(
    orderId,
    resendNoticeCode(
      await resendBookingConfirmation(caller, { orderId, resendId }),
    ),
  );
}

export async function voidLinksAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(opsBookingsPath);
  const orderId = orderIdOrLeave(formData);
  return backToBooking(
    orderId,
    voidNoticeCode(await voidBookingLinks(caller, orderId)),
  );
}
