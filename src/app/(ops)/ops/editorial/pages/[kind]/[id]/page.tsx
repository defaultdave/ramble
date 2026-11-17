import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import { PageCopyForm } from '@/components/EditorialAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { StatusBadge } from '@/components/StatusBadge';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import { entryStatusLabels, entryStatusTones } from '@/lib/editorialAdmin';
import {
  findPageTarget,
  pageFormFields,
  pageNoticeCodes,
  pageNotices,
  pagesPath,
  parsePageKind,
} from '@/lib/editorialPages';
import { noticeText, parseNotice, parseProblemFields } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { savePageCopyAction } from '@/server/actions/editorialContent';
import { listPageCopyForEditing } from '@/server/db/editorial';
import { listTaxonomyForEditing } from '@/server/db/taxonomy';
import { readOpsCaller } from '@/server/opsCaller';

const copy = opsEditorialContentCopy.pages;

export const metadata: Metadata = { title: copy.editTitle };

export default async function EditPageCopyPage({
  params,
  searchParams,
}: PageProps<'/ops/editorial/pages/[kind]/[id]'>) {
  const [{ kind: rawKind, id }, query, caller] = await Promise.all([
    params,
    searchParams,
    readOpsCaller(),
  ]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={`${pagesPath}/${rawKind}/${id}`} />;
  }

  const kind = parsePageKind(rawKind);
  if (kind === null) notFound();
  const [terms, copies] = await Promise.all([
    listTaxonomyForEditing(caller, kind),
    listPageCopyForEditing(caller),
  ]);
  const target = findPageTarget(terms, copies, kind, id);
  if (target === null) notFound();

  return (
    <PageHeading title={target.term.name}>
      <p>
        <Link href={pagesPath}>{copy.back}</Link>{' '}
        {target.copy === null ? null : (
          <StatusBadge
            tone={entryStatusTones[target.copy.status]}
            label={entryStatusLabels[target.copy.status]}
          />
        )}
      </p>
      <ActionNotice
        notice={noticeText(
          pageNotices,
          parseNotice(query.notice, pageNoticeCodes),
        )}
      />
      <PageCopyForm
        kind={kind}
        targetId={target.term.id}
        page={target.copy}
        problems={parseProblemFields(query.fields, pageFormFields)}
        save={savePageCopyAction}
      />
    </PageHeading>
  );
}
