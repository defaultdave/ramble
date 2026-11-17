import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import { CollectionForm, CollectionItems } from '@/components/EditorialAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { StatusBadge } from '@/components/StatusBadge';
import { opsEditorialSectionsCopy } from '@/lib/copy/opsEditorialSections';
import {
  addableOptions,
  buildItemRows,
  collectionFormFields,
  collectionNoticeCodes,
  collectionNotices,
  collectionPath,
  collectionStatusLabels,
  collectionStatusTones,
  collectionsPath,
  findPick,
  itemFormFields,
} from '@/lib/editorialCollections';
import {
  noticeText,
  parseIdField,
  parseNotice,
  parseProblemFields,
} from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import {
  collectionItemsAction,
  saveCollectionAction,
} from '@/server/actions/editorial';
import {
  listCollectionsForEditing,
  listExperienceChoicesForEditing,
} from '@/server/db/editorial';
import { readOpsCaller } from '@/server/opsCaller';

const copy = opsEditorialSectionsCopy.collections;

export const metadata: Metadata = { title: copy.editTitle };

export default async function EditCollectionPage({
  params,
  searchParams,
}: PageProps<'/ops/editorial/collections/[id]'>) {
  const [{ id }, query, caller] = await Promise.all([
    params,
    searchParams,
    readOpsCaller(),
  ]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={collectionPath(id)} />;
  }

  const collectionId = parseIdField(id);
  const [collections, choices] = await Promise.all([
    listCollectionsForEditing(caller),
    listExperienceChoicesForEditing(caller),
  ]);
  const pick =
    collectionId === null ? null : findPick(collections, collectionId);
  if (pick === null) notFound();

  return (
    <PageHeading title={pick.title}>
      <p>
        <Link href={collectionsPath}>{copy.back}</Link>{' '}
        <StatusBadge
          tone={collectionStatusTones[pick.status]}
          label={collectionStatusLabels[pick.status]}
        />
      </p>
      <ActionNotice
        notice={noticeText(
          collectionNotices,
          parseNotice(query.notice, collectionNoticeCodes),
        )}
      />
      <CollectionForm
        collection={pick}
        problems={parseProblemFields(query.fields, collectionFormFields)}
        save={saveCollectionAction}
      />
      <CollectionItems
        collectionId={pick.id}
        rows={buildItemRows(pick.items, choices)}
        options={addableOptions(pick.items, choices)}
        problems={parseProblemFields(query.fields, itemFormFields)}
        act={collectionItemsAction}
      />
    </PageHeading>
  );
}
