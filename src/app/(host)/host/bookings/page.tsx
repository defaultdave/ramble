import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { HostGuestLists, hostBookingsTitle } from '@/components/HostGuestLists';
import { hostBookingsPath } from '@/lib/hostGuestLists';
import { signInHref } from '@/lib/signIn';
import { parseSearchTerm } from '@/lib/tableQuery';
import { loadHostBookings } from '@/server/hostGuestLists';

export const metadata: Metadata = { title: hostBookingsTitle };

/** The same gate as the dashboard: sign in first, and anyone who owns no host sees the area's not-found page. */
export default async function HostBookingsPage({
  searchParams,
}: PageProps<'/host/bookings'>) {
  const query = await searchParams;
  const term = parseSearchTerm(query.q);
  const result = await loadHostBookings(term);
  if (result.status === 'signed_out') redirect(signInHref(hostBookingsPath));
  if (result.status === 'refused') notFound();
  return <HostGuestLists view={result.view} />;
}
