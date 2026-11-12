import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import { ExperienceReviewView } from '@/components/ExperienceReview';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import {
  photoNumberFields,
  reviewItemPath,
  reviewNoticeCodes,
  reviewNoticeText,
  reviewPath,
} from '@/lib/experienceReview';
import { parseIdField, parseNotice, parseProblemFields } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import {
  approveExperienceAction,
  rejectExperienceAction,
} from '@/server/actions/experienceReview';
import { readExperienceForOps } from '@/server/db/experienceEditor';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Review experience' };

export default async function ReviewExperiencePage({
  params,
  searchParams,
}: PageProps<'/ops/review/[id]'>) {
  const [{ id }, query, caller] = await Promise.all([
    params,
    searchParams,
    readOpsCaller(),
  ]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={reviewItemPath(id)} />;
  }

  const experienceId = parseIdField(id);
  const view =
    experienceId === null
      ? null
      : await readExperienceForOps(caller, experienceId);
  if (view === null) notFound();

  return (
    <PageHeading title={view.content.name}>
      <p>
        <Link href={reviewPath}>Back to the review queue</Link>
      </p>
      <ActionNotice
        notice={reviewNoticeText(
          parseNotice(query.notice, reviewNoticeCodes),
          parseProblemFields(query.fields, photoNumberFields),
        )}
      />
      <ExperienceReviewView
        view={view}
        approve={approveExperienceAction}
        reject={rejectExperienceAction}
      />
    </PageHeading>
  );
}
