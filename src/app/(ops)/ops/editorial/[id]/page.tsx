import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import { EntryForm } from '@/components/EditorialAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { StatusBadge } from '@/components/StatusBadge';
import {
  editorialPath,
  entryFormFields,
  entryNoticeCodes,
  entryNotices,
  entryPath,
  entryStatusLabels,
  entryStatusTones,
} from '@/lib/editorialAdmin';
import {
  noticeText,
  parseIdField,
  parseNotice,
  parseProblemFields,
} from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { saveEntryAction } from '@/server/actions/editorial';
import { getHelpArticleForEditing } from '@/server/db/editorial';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Edit article' };

export default async function EditEntryPage({
  params,
  searchParams,
}: PageProps<'/ops/editorial/[id]'>) {
  const [{ id }, query, caller] = await Promise.all([
    params,
    searchParams,
    readOpsCaller(),
  ]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={entryPath(id)} />;
  }

  const entryId = parseIdField(id);
  const entry =
    entryId === null ? null : await getHelpArticleForEditing(caller, entryId);
  if (entry === null) notFound();

  return (
    <PageHeading title={entry.title}>
      <p>
        <Link href={editorialPath}>Back to the articles</Link>{' '}
        <StatusBadge
          tone={entryStatusTones[entry.status]}
          label={entryStatusLabels[entry.status]}
        />
      </p>
      <ActionNotice
        notice={noticeText(
          entryNotices,
          parseNotice(query.notice, entryNoticeCodes),
        )}
      />
      <EntryForm
        entry={entry}
        problems={parseProblemFields(query.fields, entryFormFields)}
        save={saveEntryAction}
      />
    </PageHeading>
  );
}
