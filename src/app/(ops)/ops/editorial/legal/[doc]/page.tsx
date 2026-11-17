import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import { LegalDraftForm, LegalVersions } from '@/components/EditorialAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import {
  buildLegalVersionRows,
  draftStart,
  legalAdminPath,
  legalDocLabel,
  legalDocPath,
  legalFormFields,
  legalNoticeCodes,
  legalNotices,
  mayStartDraft,
  parseLegalDocParam,
} from '@/lib/editorialLegal';
import { noticeText, parseNotice, parseProblemFields } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { startLegalDraftAction } from '@/server/actions/editorialContent';
import { listLegalVersions } from '@/server/db/legal';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { readOpsCaller } from '@/server/opsCaller';

const copy = opsEditorialContentCopy.legal;

export const metadata: Metadata = { title: copy.title };

export default async function LegalVersionsPage({
  params,
  searchParams,
}: PageProps<'/ops/editorial/legal/[doc]'>) {
  const [{ doc: rawDoc }, query, caller] = await Promise.all([
    params,
    searchParams,
    readOpsCaller(),
  ]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={legalDocPath(rawDoc)} />;
  }

  const doc = parseLegalDocParam(rawDoc);
  if (doc === null) notFound();
  const versions = await listLegalVersions(caller, doc).catch(
    (error: unknown) => {
      rethrowOrLog('The legal versions could not be read', error);
      return null;
    },
  );
  if (
    versions !== null &&
    !mayStartDraft(
      doc,
      versions.map((version) => version.doc),
    )
  ) {
    notFound();
  }
  const start = draftStart(versions ?? []);
  return (
    <PageHeading title={legalDocLabel(doc)}>
      <p>
        <Link href={legalAdminPath}>{copy.backToDocuments}</Link>
      </p>
      <ActionNotice
        notice={noticeText(
          legalNotices,
          parseNotice(query.notice, legalNoticeCodes),
        )}
      />
      <LegalVersions
        doc={doc}
        rows={versions === null ? [] : buildLegalVersionRows(versions)}
        query={query}
        failed={versions === null}
      />
      {versions === null ? null : (
        <section>
          <h2>{copy.newDraft.heading}</h2>
          <p>{copy.newDraft.hint}</p>
          <LegalDraftForm
            doc={doc}
            draftId={null}
            title={start.title}
            body={start.body}
            problems={parseProblemFields(query.fields, legalFormFields)}
            save={startLegalDraftAction}
          />
        </section>
      )}
    </PageHeading>
  );
}
