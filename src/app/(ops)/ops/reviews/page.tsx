import type { Metadata } from 'next';
import { ActionNotice } from '@/components/ActionNotice';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { ReviewModeration } from '@/components/ReviewModeration';
import { reviewModerationCopy } from '@/lib/copy/reviewModeration';
import { noticeText, parseNotice } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import {
  parseReviewStatus,
  reviewModerationNoticeCodes,
  reviewModerationNotices,
  reviewModerationPath,
} from '@/lib/reviewModeration';
import { parseCursor } from '@/lib/tableQuery';
import {
  hideReviewAction,
  unhideReviewAction,
} from '@/server/actions/opsReviews';
import { readReviewsForModeration } from '@/server/db/reviewModeration';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: reviewModerationCopy.title };

export default async function ReviewModerationPage({
  searchParams,
}: PageProps<'/ops/reviews'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={reviewModerationPath} />;
  }

  const cursor = parseCursor(query.cursor);
  const page = await readReviewsForModeration(caller, {
    status: parseReviewStatus(query.status),
    cursor,
  });
  return (
    <PageHeading title={reviewModerationCopy.title}>
      <ActionNotice
        notice={noticeText(
          reviewModerationNotices,
          parseNotice(query.notice, reviewModerationNoticeCodes),
        )}
      />
      <ReviewModeration
        rows={page.rows}
        query={query}
        cursor={cursor}
        nextCursor={page.nextCursor}
        hide={hideReviewAction}
        unhide={unhideReviewAction}
      />
    </PageHeading>
  );
}
