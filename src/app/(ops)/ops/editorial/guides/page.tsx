import type { Metadata } from 'next';
import { ActionNotice } from '@/components/ActionNotice';
import { GuidesList } from '@/components/EditorialAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { opsEditorialContentCopy } from '@/lib/copy/opsEditorialContent';
import {
  guideNoticeCodes,
  guideNotices,
  guidesPath,
} from '@/lib/editorialGuides';
import { noticeText, parseNotice } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { parseCursor } from '@/lib/tableQuery';
import { readExperiencesForOps } from '@/server/db/experienceEditor';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { readOpsCaller } from '@/server/opsCaller';

const copy = opsEditorialContentCopy.guides;

export const metadata: Metadata = { title: copy.title };

export default async function GuideEntriesPage({
  searchParams,
}: PageProps<'/ops/editorial/guides'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={guidesPath} />;
  }

  const cursor = parseCursor(query.cursor);
  const page = await readExperiencesForOps(
    caller,
    { status: 'guide_only', hostId: null, categoryId: null },
    cursor,
  ).catch((error: unknown) => {
    rethrowOrLog('The guide entries could not be read', error);
    return null;
  });
  return (
    <PageHeading title={copy.title}>
      <p>{copy.intro}</p>
      <ActionNotice
        notice={noticeText(
          guideNotices,
          parseNotice(query.notice, guideNoticeCodes),
        )}
      />
      <GuidesList
        rows={page?.rows ?? []}
        query={query}
        cursor={cursor}
        nextCursor={page?.nextCursor ?? null}
        failed={page === null}
      />
    </PageHeading>
  );
}
