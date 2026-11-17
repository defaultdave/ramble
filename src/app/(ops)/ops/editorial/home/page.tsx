import type { Metadata } from 'next';
import { ActionNotice } from '@/components/ActionNotice';
import { HomeModulesList } from '@/components/EditorialAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { opsEditorialSectionsCopy } from '@/lib/copy/opsEditorialSections';
import {
  buildHomeModuleRows,
  homeNoticeCodes,
  homeNotices,
  homePath,
} from '@/lib/editorialHome';
import { noticeText, parseNotice } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { homeModuleOpAction } from '@/server/actions/editorial';
import {
  listCollectionsForEditing,
  listHomeModulesForEditing,
} from '@/server/db/editorial';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { readOpsCaller } from '@/server/opsCaller';

const copy = opsEditorialSectionsCopy.home;

export const metadata: Metadata = { title: copy.title };

export default async function HomeModulesPage({
  searchParams,
}: PageProps<'/ops/editorial/home'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={homePath} />;
  }

  const read = await Promise.all([
    listHomeModulesForEditing(caller),
    listCollectionsForEditing(caller),
  ]).catch((error: unknown) => {
    rethrowOrLog('The home page modules could not be read', error);
    return null;
  });
  return (
    <PageHeading title={copy.title}>
      <p>{copy.intro}</p>
      <ActionNotice
        notice={noticeText(
          homeNotices,
          parseNotice(query.notice, homeNoticeCodes),
        )}
      />
      <HomeModulesList
        rows={read === null ? [] : buildHomeModuleRows(...read)}
        act={homeModuleOpAction}
        failed={read === null}
      />
    </PageHeading>
  );
}
