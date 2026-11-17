import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import { TaxonomyTermForm } from '@/components/EditorialAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import {
  findTerm,
  parseKindParam,
  taxonomyFormFields,
  taxonomyNoticeCodes,
  taxonomyNotices,
  taxonomyPath,
} from '@/lib/editorialTaxonomy';
import { noticeText, parseNotice, parseProblemFields } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { renameTaxonomyAction } from '@/server/actions/editorialContent';
import { listTaxonomyForEditing } from '@/server/db/taxonomy';
import { readOpsCaller } from '@/server/opsCaller';

const copy = opsEditorialContentCopy.taxonomy;

export const metadata: Metadata = { title: copy.renameTitle };

export default async function RenameTermPage({
  params,
  searchParams,
}: PageProps<'/ops/editorial/taxonomy/[kind]/[id]'>) {
  const [{ kind: rawKind, id }, query, caller] = await Promise.all([
    params,
    searchParams,
    readOpsCaller(),
  ]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={`${taxonomyPath}/${rawKind}/${id}`} />;
  }

  const kind = parseKindParam(rawKind);
  if (kind === null) notFound();
  const term = findTerm(await listTaxonomyForEditing(caller, kind), id);
  if (term === null) notFound();

  return (
    <PageHeading title={term.name}>
      <p>
        <Link href={taxonomyPath}>{copy.back}</Link>
      </p>
      <ActionNotice
        notice={noticeText(
          taxonomyNotices,
          parseNotice(query.notice, taxonomyNoticeCodes),
        )}
      />
      <TaxonomyTermForm
        kind={kind}
        term={{ id: term.id, name: term.name }}
        problems={parseProblemFields(query.fields, taxonomyFormFields)}
        save={renameTaxonomyAction}
      />
    </PageHeading>
  );
}
