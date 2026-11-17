import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import { TaxonomyTermForm } from '@/components/EditorialAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import {
  newTermPath,
  parseKindParam,
  taxonomyFormFields,
  taxonomyNoticeCodes,
  taxonomyNotices,
  taxonomyPath,
} from '@/lib/editorialTaxonomy';
import { noticeText, parseNotice, parseProblemFields } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { addTaxonomyAction } from '@/server/actions/editorialContent';
import { readOpsCaller } from '@/server/opsCaller';

const copy = opsEditorialContentCopy.taxonomy;

export const metadata: Metadata = { title: copy.title };

export default async function NewTermPage({
  params,
  searchParams,
}: PageProps<'/ops/editorial/taxonomy/[kind]/new'>) {
  const [{ kind: rawKind }, query, caller] = await Promise.all([
    params,
    searchParams,
    readOpsCaller(),
  ]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={newTermPath(rawKind)} />;
  }

  const kind = parseKindParam(rawKind);
  if (kind === null) notFound();
  return (
    <PageHeading title={copy.add.heading[kind]}>
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
        term={null}
        problems={parseProblemFields(query.fields, taxonomyFormFields)}
        save={addTaxonomyAction}
      />
    </PageHeading>
  );
}
