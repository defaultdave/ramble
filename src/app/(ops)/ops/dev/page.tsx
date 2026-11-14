import type { Metadata } from 'next';
import { ActionNotice } from '@/components/ActionNotice';
import { OpsDevConsole } from '@/components/OpsDev';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import {
  devConsoleOpen,
  holdsDevConsoleRole,
  opsDevNoticeCodes,
  opsDevNotices,
  opsDevPath,
  reportLine,
  utcLabel,
} from '@/lib/opsDev';
import { noticeText, parseNotice } from '@/lib/opsForm';
import {
  drainOpsJobsAction,
  runOpsJobAction,
  runOpsPulseAction,
  setOpsClockAction,
} from '@/server/actions/opsDev';
import { readRecentJobs } from '@/server/db/opsJobs';
import { env } from '@/server/env';
import { readOpsCaller } from '@/server/opsCaller';
import { readTestClock } from '@/server/testClock';

export const metadata: Metadata = { title: 'Test console' };

export default async function OpsDevPage({
  searchParams,
}: PageProps<'/ops/dev'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsDevConsoleRole(caller.roles)) {
    return <OpsAccessDenied next={opsDevPath} title="Test console" />;
  }
  if (!devConsoleOpen(env.VERCEL_ENV)) {
    return (
      <PageHeading title="Test console">
        <p>The test console is not available on a production deployment.</p>
      </PageHeading>
    );
  }

  const [rows, testClock] = await Promise.all([
    readRecentJobs(),
    readTestClock(),
  ]);
  const report = reportLine(query);
  return (
    <PageHeading title="Test console">
      <ActionNotice
        notice={noticeText(
          opsDevNotices,
          parseNotice(query.notice, opsDevNoticeCodes),
        )}
      />
      {report === null ? null : <p role="status">{report}.</p>}
      <OpsDevConsole
        rows={rows}
        query={query}
        testTimeLabel={testClock ? utcLabel(testClock) : null}
        demoClockOn={env.DEMO_CLOCK === 'on'}
        actions={{
          runJob: runOpsJobAction,
          drain: drainOpsJobsAction,
          pulse: runOpsPulseAction,
          setClock: setOpsClockAction,
        }}
      />
    </PageHeading>
  );
}
