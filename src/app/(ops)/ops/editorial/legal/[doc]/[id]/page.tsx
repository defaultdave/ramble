import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import { LegalDraftForm } from '@/components/EditorialAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import {
  findVersion,
  legalDocLabel,
  legalDocPath,
  legalFormFields,
  legalNoticeCodes,
  legalNotices,
  legalRedirect,
  legalVersionPath,
  parseLegalDocParam,
} from '@/lib/editorialLegal';
import { isDraft } from '@/lib/legal';
import { noticeText, parseNotice, parseProblemFields } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { saveLegalDraftAction } from '@/server/actions/editorialContent';
import { listLegalVersions } from '@/server/db/legal';
import { readOpsCaller } from '@/server/opsCaller';

const copy = opsEditorialContentCopy.legal;

export const metadata: Metadata = { title: copy.editTitle };

export default async function EditLegalDraftPage({
  params,
  searchParams,
}: PageProps<'/ops/editorial/legal/[doc]/[id]'>) {
  const [{ doc: rawDoc, id }, query, caller] = await Promise.all([
    params,
    searchParams,
    readOpsCaller(),
  ]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={legalVersionPath(rawDoc, id)} />;
  }

  const doc = parseLegalDocParam(rawDoc);
  if (doc === null) notFound();
  const version = findVersion(await listLegalVersions(caller, doc), id);
  if (version === null) notFound();
  if (!isDraft(version.status)) {
    redirect(legalRedirect(doc, null, { status: 'not_a_draft' }));
  }

  return (
    <PageHeading title={copy.editHeading(legalDocLabel(doc), version.version)}>
      <p>
        <Link href={legalDocPath(doc)}>{copy.back}</Link>
      </p>
      <ActionNotice
        notice={noticeText(
          legalNotices,
          parseNotice(query.notice, legalNoticeCodes),
        )}
      />
      <LegalDraftForm
        doc={doc}
        draftId={version.id}
        title={version.title}
        body={version.body}
        problems={parseProblemFields(query.fields, legalFormFields)}
        save={saveLegalDraftAction}
      />
    </PageHeading>
  );
}
