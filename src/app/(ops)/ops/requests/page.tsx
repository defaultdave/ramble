import type { Metadata } from 'next';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { PrivateRequestsQueue } from '@/components/PrivateRequestsQueue';
import { opsRequestsCopy } from '@/lib/copy/opsRequests';
import { holdsOpsRole } from '@/lib/opsNav';
import { opsRequestsPath } from '@/lib/opsRequests';
import { parseCursor } from '@/lib/tableQuery';
import { readOpsPrivateRequests } from '@/server/db/privateRequests';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: opsRequestsCopy.title };

export default async function PrivateRequestsPage({
  searchParams,
}: PageProps<'/ops/requests'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={opsRequestsPath} />;
  }

  const cursor = parseCursor(query.cursor);
  const page = await readOpsPrivateRequests(caller, { cursor });
  return (
    <PageHeading title={opsRequestsCopy.title}>
      <PrivateRequestsQueue
        rows={page.rows}
        query={query}
        cursor={cursor}
        nextCursor={page.nextCursor}
      />
    </PageHeading>
  );
}
