import type { Metadata } from 'next';
import { ActionNotice } from '@/components/ActionNotice';
import { EntriesList } from '@/components/EditorialAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import {
  buildEntryRows,
  editorialPath,
  entryNoticeCodes,
  entryNotices,
} from '@/lib/editorialAdmin';
import { noticeText, parseNotice } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { listHelpArticlesForEditing } from '@/server/db/editorial';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Editorial' };

export default async function EditorialPage({
  searchParams,
}: PageProps<'/ops/editorial'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={editorialPath} />;
  }

  const articles = await listHelpArticlesForEditing(caller).catch(
    (error: unknown) => {
      rethrowOrLog('The editorial list could not be read', error);
      return null;
    },
  );
  return (
    <PageHeading title="Editorial">
      <ActionNotice
        notice={noticeText(
          entryNotices,
          parseNotice(query.notice, entryNoticeCodes),
        )}
      />
      <EntriesList
        rows={articles === null ? [] : buildEntryRows(articles)}
        query={query}
        failed={articles === null}
      />
    </PageHeading>
  );
}
