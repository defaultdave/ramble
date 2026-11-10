import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { ManageBooking, ManageTooManyTries } from '@/components/ManageBooking';
import { cancelBooking } from '@/server/actions/orders';
import { readManagePage } from '@/server/manageBooking';

// The address is a capability, so nothing here may describe the booking: a generic title, no
// description, and no Open Graph or Twitter card, so a pasted link unfurls to nothing.
export const metadata: Metadata = {
  title: 'Manage booking',
  description: null,
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
  openGraph: null,
  twitter: null,
};

export default async function ManageBookingPage({
  params,
}: PageProps<'/manage/[token]'>) {
  await connection();
  const { token } = await params;
  const page = await readManagePage(token);
  if (page.kind === 'not_found') notFound();
  if (page.kind === 'rate_limited') {
    return <ManageTooManyTries retryAfterSeconds={page.retryAfterSeconds} />;
  }
  return (
    <ManageBooking view={page.view} token={token} cancel={cancelBooking} />
  );
}
