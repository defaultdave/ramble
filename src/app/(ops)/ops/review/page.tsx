import type { Metadata } from 'next';
import { ActionNotice } from '@/components/ActionNotice';
import { ReviewQueue } from '@/components/ExperienceReview';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import {
  reviewNoticeCodes,
  reviewNoticeText,
  reviewPath,
} from '@/lib/experienceReview';
import { parseNotice } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { parseCursor } from '@/lib/tableQuery';
import { readExperiencesForOps } from '@/server/db/experienceEditor';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Review queue' };

export default async function ReviewQueuePage({
  searchParams,
}: PageProps<'/ops/review'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={reviewPath} />;
  }

  const cursor = parseCursor(query.cursor);
  const page = await readExperiencesForOps(
    caller,
    { status: 'in_review', hostId: null, categoryId: null },
    cursor,
  );
  return (
    <PageHeading title="Review queue">
      <ActionNotice
        notice={reviewNoticeText(
          parseNotice(query.notice, reviewNoticeCodes),
          [],
        )}
      />
      <ReviewQueue
        rows={page.rows}
        query={query}
        cursor={cursor}
        nextCursor={page.nextCursor}
      />
    </PageHeading>
  );
}
