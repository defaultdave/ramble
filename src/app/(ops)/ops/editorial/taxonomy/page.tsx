import type { Metadata } from 'next';
import { ActionNotice } from '@/components/ActionNotice';
import { TaxonomyLists } from '@/components/EditorialAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import {
  buildTaxonomyRows,
  taxonomyNoticeCodes,
  taxonomyNotices,
  taxonomyPath,
} from '@/lib/editorialTaxonomy';
import { noticeText, parseNotice } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { taxonomyClickAction } from '@/server/actions/editorialContent';
import { listTaxonomyForEditing } from '@/server/db/taxonomy';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { readOpsCaller } from '@/server/opsCaller';

const copy = opsEditorialContentCopy.taxonomy;

export const metadata: Metadata = { title: copy.title };

export default async function TaxonomyPage({
  searchParams,
}: PageProps<'/ops/editorial/taxonomy'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={taxonomyPath} />;
  }

  const read = await Promise.all([
    listTaxonomyForEditing(caller, 'category'),
    listTaxonomyForEditing(caller, 'neighborhood'),
  ]).catch((error: unknown) => {
    rethrowOrLog('The categories and neighborhoods could not be read', error);
    return null;
  });
  return (
    <PageHeading title={copy.title}>
      <p>{copy.intro}</p>
      <ActionNotice
        notice={noticeText(
          taxonomyNotices,
          parseNotice(query.notice, taxonomyNoticeCodes),
        )}
      />
      <TaxonomyLists
        categories={read === null ? [] : buildTaxonomyRows('category', read[0])}
        neighborhoods={
          read === null ? [] : buildTaxonomyRows('neighborhood', read[1])
        }
        act={taxonomyClickAction}
        failed={read === null}
      />
    </PageHeading>
  );
}
