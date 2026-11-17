import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import { GuideLinksForm } from '@/components/EditorialAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import {
  guideFormFields,
  guideNoticeCodes,
  guideNotices,
  guidePath,
  guidesPath,
  isGuideEntry,
} from '@/lib/editorialGuides';
import { experiencePath } from '@/lib/experienceEditor';
import {
  noticeText,
  parseIdField,
  parseNotice,
  parseProblemFields,
} from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { saveGuideLinksAction } from '@/server/actions/editorialContent';
import { readExperienceForOps } from '@/server/db/experienceEditor';
import { readOpsCaller } from '@/server/opsCaller';

const copy = opsEditorialContentCopy.guides;

export const metadata: Metadata = { title: copy.editTitle };

export default async function EditGuideEntryPage({
  params,
  searchParams,
}: PageProps<'/ops/editorial/guides/[id]'>) {
  const [{ id }, query, caller] = await Promise.all([
    params,
    searchParams,
    readOpsCaller(),
  ]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={guidePath(id)} />;
  }

  const experienceId = parseIdField(id);
  const view =
    experienceId === null
      ? null
      : await readExperienceForOps(caller, experienceId);
  if (view === null || !isGuideEntry(view.status)) notFound();

  return (
    <PageHeading title={view.content.name}>
      <p>
        <Link href={guidesPath}>{copy.back}</Link>
        {' · '}
        <Link href={experiencePath(view.id)}>{copy.editExperience}</Link>
      </p>
      <ActionNotice
        notice={noticeText(
          guideNotices,
          parseNotice(query.notice, guideNoticeCodes),
        )}
      />
      <GuideLinksForm
        experienceId={view.id}
        linkOutUrl={view.content.linkOutUrl}
        affiliateUrl={view.content.affiliateUrl}
        problems={parseProblemFields(query.fields, guideFormFields)}
        save={saveGuideLinksAction}
      />
    </PageHeading>
  );
}
