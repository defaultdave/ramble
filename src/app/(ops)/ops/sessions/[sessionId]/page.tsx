import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import { OpsAccessDenied } from '@/components/OpsShell';
import { SessionDetail } from '@/components/OpsSessions';
import { PageHeading } from '@/components/PageHeading';
import { parseIdField } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { opsSessionPath, sessionNotice } from '@/lib/opsSessions';
import {
  cancelOpsSessionAction,
  changeOpsAllocationAction,
  pauseOpsExperienceAction,
} from '@/server/actions/opsSessions';
import { readOpsSession } from '@/server/db/opsSessions';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Session' };

export default async function SessionPage({
  params,
  searchParams,
}: PageProps<'/ops/sessions/[sessionId]'>) {
  const [{ sessionId }, query, caller] = await Promise.all([
    params,
    searchParams,
    readOpsCaller(),
  ]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={opsSessionPath(sessionId)} />;
  }

  const id = parseIdField(sessionId);
  const detail = id === null ? null : await readOpsSession(caller, id);
  if (detail === null) notFound();
  return (
    <PageHeading title={detail.session.title}>
      <ActionNotice notice={sessionNotice(query)} />
      <SessionDetail
        session={detail.session}
        impact={detail.impact}
        pause={detail.pause}
        actions={{
          cancel: cancelOpsSessionAction,
          allocation: changeOpsAllocationAction,
          pause: pauseOpsExperienceAction,
        }}
      />
    </PageHeading>
  );
}
