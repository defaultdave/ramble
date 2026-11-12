import type { Metadata } from 'next';
import { ActionNotice } from '@/components/ActionNotice';
import { ButtonLink } from '@/components/Button';
import { HostsTable } from '@/components/HostSetup';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import {
  hostNoticeCodes,
  hostNotices,
  hostsPath,
  newHostPath,
} from '@/lib/hostSetup';
import { noticeText, parseNotice } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { parseCursor } from '@/lib/tableQuery';
import { readHostsForOps } from '@/server/db/hostSetup';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Hosts' };

export default async function HostsPage({
  searchParams,
}: PageProps<'/ops/hosts'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) return <OpsAccessDenied next={hostsPath} />;

  const cursor = parseCursor(query.cursor);
  const page = await readHostsForOps(caller, cursor);
  return (
    <PageHeading title="Hosts">
      <ActionNotice
        notice={noticeText(
          hostNotices,
          parseNotice(query.notice, hostNoticeCodes),
        )}
      />
      <p>
        <ButtonLink href={newHostPath}>Add a host</ButtonLink>
      </p>
      <HostsTable
        rows={page.rows}
        query={query}
        cursor={cursor}
        nextCursor={page.nextCursor}
      />
    </PageHeading>
  );
}
