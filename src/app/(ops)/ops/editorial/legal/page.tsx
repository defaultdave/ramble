import type { Metadata } from 'next';
import { ActionNotice } from '@/components/ActionNotice';
import { LegalDocsList } from '@/components/EditorialAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import {
  buildLegalDocRows,
  legalAdminPath,
  legalNoticeCodes,
  legalNotices,
} from '@/lib/editorialLegal';
import { noticeText, parseNotice } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { listLegalDocSummaries } from '@/server/db/legalAdmin';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { readOpsCaller } from '@/server/opsCaller';

const copy = opsEditorialContentCopy.legal;

export const metadata: Metadata = { title: copy.title };

export default async function LegalDocumentsPage({
  searchParams,
}: PageProps<'/ops/editorial/legal'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={legalAdminPath} />;
  }

  const summaries = await listLegalDocSummaries(caller).catch(
    (error: unknown) => {
      rethrowOrLog('The legal documents could not be read', error);
      return null;
    },
  );
  return (
    <PageHeading title={copy.title}>
      <p>{copy.intro}</p>
      <ActionNotice
        notice={noticeText(
          legalNotices,
          parseNotice(query.notice, legalNoticeCodes),
        )}
      />
      <LegalDocsList
        rows={summaries === null ? [] : buildLegalDocRows(summaries)}
        failed={summaries === null}
      />
    </PageHeading>
  );
}
