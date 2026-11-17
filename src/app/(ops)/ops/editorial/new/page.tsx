import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionNotice } from '@/components/ActionNotice';
import { EntryForm } from '@/components/EditorialAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import {
  editorialPath,
  entryFormFields,
  entryNoticeCodes,
  entryNotices,
  newEntryPath,
} from '@/lib/editorialAdmin';
import { noticeText, parseNotice, parseProblemFields } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { saveEntryAction } from '@/server/actions/editorial';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'New article' };

export default async function NewEntryPage({
  searchParams,
}: PageProps<'/ops/editorial/new'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={newEntryPath} />;
  }

  return (
    <PageHeading title="New article">
      <p>
        <Link href={editorialPath}>Back to the articles</Link>
      </p>
      <p>It starts as a draft. Guests cannot read it until you publish it.</p>
      <ActionNotice
        notice={noticeText(
          entryNotices,
          parseNotice(query.notice, entryNoticeCodes),
        )}
      />
      <EntryForm
        entry={null}
        problems={parseProblemFields(query.fields, entryFormFields)}
        save={saveEntryAction}
      />
    </PageHeading>
  );
}
