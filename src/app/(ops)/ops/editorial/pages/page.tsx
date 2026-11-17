import type { Metadata } from 'next';
import { ActionNotice } from '@/components/ActionNotice';
import { PageCopyList } from '@/components/EditorialAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import {
  buildPageRows,
  pageNoticeCodes,
  pageNotices,
  pagesPath,
} from '@/lib/editorialPages';
import { noticeText, parseNotice } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { listPageCopyForEditing } from '@/server/db/editorial';
import { listTaxonomyForEditing } from '@/server/db/taxonomy';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { readOpsCaller } from '@/server/opsCaller';

const copy = opsEditorialContentCopy.pages;

export const metadata: Metadata = { title: copy.title };

export default async function PageCopyPage({
  searchParams,
}: PageProps<'/ops/editorial/pages'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={pagesPath} />;
  }

  const read = await Promise.all([
    listTaxonomyForEditing(caller, 'category'),
    listTaxonomyForEditing(caller, 'neighborhood'),
    listPageCopyForEditing(caller),
  ]).catch((error: unknown) => {
    rethrowOrLog('The page copy list could not be read', error);
    return null;
  });
  return (
    <PageHeading title={copy.title}>
      <p>{copy.intro}</p>
      <ActionNotice
        notice={noticeText(
          pageNotices,
          parseNotice(query.notice, pageNoticeCodes),
        )}
      />
      <PageCopyList
        categories={
          read === null ? [] : buildPageRows('category', read[0], read[2])
        }
        neighborhoods={
          read === null ? [] : buildPageRows('neighborhood', read[1], read[2])
        }
        query={query}
        failed={read === null}
      />
    </PageHeading>
  );
}
