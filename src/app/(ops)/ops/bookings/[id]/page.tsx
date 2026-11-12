import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OpsBookingDetailView } from '@/components/OpsBookings';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { opsBookingPath } from '@/lib/opsBookings';
import { parseIdField } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { readOpsBooking } from '@/server/db/opsBookings';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Booking' };

export default async function OpsBookingPage({
  params,
}: PageProps<'/ops/bookings/[id]'>) {
  const [{ id }, caller] = await Promise.all([params, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={opsBookingPath(id)} />;
  }

  const orderId = parseIdField(id);
  const detail =
    orderId === null ? null : await readOpsBooking(caller, orderId);
  if (detail === null) notFound();

  return (
    <PageHeading title={detail.row.reference}>
      <OpsBookingDetailView detail={detail} />
    </PageHeading>
  );
}
