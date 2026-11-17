import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionNotice } from '@/components/ActionNotice';
import { CollectionForm } from '@/components/EditorialAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { opsEditorialSectionsCopy } from '@/lib/copy/opsEditorialSections';
import {
  collectionFormFields,
  collectionNoticeCodes,
  collectionNotices,
  collectionsPath,
  newCollectionPath,
} from '@/lib/editorialCollections';
import { noticeText, parseNotice, parseProblemFields } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { saveCollectionAction } from '@/server/actions/editorial';
import { readOpsCaller } from '@/server/opsCaller';

const copy = opsEditorialSectionsCopy.collections;

export const metadata: Metadata = { title: copy.newTitle };

export default async function NewCollectionPage({
  searchParams,
}: PageProps<'/ops/editorial/collections/new'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={newCollectionPath} />;
  }

  return (
    <PageHeading title={copy.newTitle}>
      <p>
        <Link href={collectionsPath}>{copy.back}</Link>
      </p>
      <p>{copy.newIntro}</p>
      <ActionNotice
        notice={noticeText(
          collectionNotices,
          parseNotice(query.notice, collectionNoticeCodes),
        )}
      />
      <CollectionForm
        collection={null}
        problems={parseProblemFields(query.fields, collectionFormFields)}
        save={saveCollectionAction}
      />
    </PageHeading>
  );
}
