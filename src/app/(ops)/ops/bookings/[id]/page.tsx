import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import { OpsBookingDetailView } from '@/components/OpsBookings';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import {
  opsBookingNotices,
  opsBookingPath,
  opsNoticeCodes,
} from '@/lib/opsBookings';
import { noticeText, parseIdField, parseNotice } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import {
  cancelBookingAction,
  refundBookingAction,
  resendConfirmationAction,
  retryRefundAction,
  voidLinksAction,
} from '@/server/actions/opsBookings';
import { readOpsBooking } from '@/server/db/opsBookings';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Booking' };

export default async function OpsBookingPage({
  params,
  searchParams,
}: PageProps<'/ops/bookings/[id]'>) {
  const [{ id }, query, caller] = await Promise.all([
    params,
    searchParams,
    readOpsCaller(),
  ]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={opsBookingPath(id)} />;
  }

  const orderId = parseIdField(id);
  const detail =
    orderId === null ? null : await readOpsBooking(caller, orderId);
  if (detail === null) notFound();

  return (
    <PageHeading title={detail.row.reference}>
      <ActionNotice
        notice={noticeText(
          opsBookingNotices,
          parseNotice(query.notice, opsNoticeCodes),
        )}
      />
      <OpsBookingDetailView
        detail={detail}
        actions={{
          cancel: cancelBookingAction,
          refund: refundBookingAction,
          retryRefund: retryRefundAction,
          resend: resendConfirmationAction,
          voidLinks: voidLinksAction,
        }}
      />
    </PageHeading>
  );
}
