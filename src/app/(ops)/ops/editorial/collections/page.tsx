import type { Metadata } from 'next';
import { ActionNotice } from '@/components/ActionNotice';
import { CollectionsList } from '@/components/EditorialAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { opsEditorialSectionsCopy } from '@/lib/copy/opsEditorialSections';
import {
  buildCollectionRows,
  collectionNoticeCodes,
  collectionNotices,
  collectionsPath,
} from '@/lib/editorialCollections';
import { noticeText, parseNotice } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { listCollectionsForEditing } from '@/server/db/editorial';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { readOpsCaller } from '@/server/opsCaller';

const copy = opsEditorialSectionsCopy.collections;

export const metadata: Metadata = { title: copy.title };

export default async function CollectionsPage({
  searchParams,
}: PageProps<'/ops/editorial/collections'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={collectionsPath} />;
  }

  const collections = await listCollectionsForEditing(caller).catch(
    (error: unknown) => {
      rethrowOrLog('The collections could not be read', error);
      return null;
    },
  );
  return (
    <PageHeading title={copy.title}>
      <ActionNotice
        notice={noticeText(
          collectionNotices,
          parseNotice(query.notice, collectionNoticeCodes),
        )}
      />
      <CollectionsList
        rows={collections === null ? [] : buildCollectionRows(collections)}
        query={query}
        failed={collections === null}
      />
    </PageHeading>
  );
}
