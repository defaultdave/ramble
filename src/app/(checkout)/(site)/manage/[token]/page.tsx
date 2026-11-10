import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { ManageBooking, ManageTooManyTries } from '@/components/ManageBooking';
import { managePageState } from '@/lib/manageBooking';
import { cancelBookingForm } from '@/server/actions/orders';
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
  searchParams,
}: PageProps<'/manage/[token]'>) {
  await connection();
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const page = await readManagePage(token);
  if (page.kind === 'refused') {
    if (page.refusal.status === 'rate_limited') {
      return (
        <ManageTooManyTries
          retryAfterSeconds={page.refusal.retryAfterSeconds}
        />
      );
    }
    notFound();
  }
  const { notice, confirming } = managePageState(page.view, query);
  return (
    <ManageBooking
      view={page.view}
      token={token}
      notice={notice}
      confirming={confirming}
      cancelAction={cancelBookingForm}
    />
  );
}
