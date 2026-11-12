import type { Metadata } from 'next';
import { ActionNotice } from '@/components/ActionNotice';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { SupportQueue } from '@/components/SupportQueue';
import { noticeText, parseNotice } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import {
  parseSupportStatus,
  supportNoticeCodes,
  supportNotices,
  supportQueuePath,
} from '@/lib/supportQueue';
import { parseCursor } from '@/lib/tableQuery';
import { resolveSupportRequestAction } from '@/server/actions/opsSupport';
import { readSupportQueue } from '@/server/db/supportQueue';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Support' };

export default async function SupportPage({
  searchParams,
}: PageProps<'/ops/support'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={supportQueuePath} />;
  }

  const cursor = parseCursor(query.cursor);
  const page = await readSupportQueue(caller, {
    status: parseSupportStatus(query.status),
    cursor,
  });
  return (
    <PageHeading title="Support">
      <ActionNotice
        notice={noticeText(
          supportNotices,
          parseNotice(query.notice, supportNoticeCodes),
        )}
      />
      <SupportQueue
        rows={page.rows}
        query={query}
        cursor={cursor}
        nextCursor={page.nextCursor}
        resolve={resolveSupportRequestAction}
      />
    </PageHeading>
  );
}
