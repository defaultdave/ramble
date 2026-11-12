import type { Metadata } from 'next';
import { OpsBookingsList } from '@/components/OpsBookings';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import {
  opsBookingsPath,
  parseBookingFilter,
  parseBookingSearch,
  searchSummary,
} from '@/lib/opsBookings';
import { holdsOpsRole } from '@/lib/opsNav';
import { parseCursor, parseSearchTerm } from '@/lib/tableQuery';
import { readOpsBookings } from '@/server/db/opsBookings';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Bookings' };

export default async function OpsBookingsPage({
  searchParams,
}: PageProps<'/ops/bookings'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={opsBookingsPath} />;
  }

  const cursor = parseCursor(query.cursor);
  const search = parseBookingSearch(query.q);
  const page = await readOpsBookings(caller, {
    search,
    filter: parseBookingFilter(query.status),
    cursor,
  });
  return (
    <PageHeading title="Bookings">
      <OpsBookingsList
        rows={page.rows}
        query={query}
        term={parseSearchTerm(query.q)}
        summary={searchSummary(search, page.rows.length)}
        cursor={cursor}
        nextCursor={page.nextCursor}
      />
    </PageHeading>
  );
}
