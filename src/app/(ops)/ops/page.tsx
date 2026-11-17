import type { Metadata } from 'next';
import { OpsDashboard } from '@/components/OpsDashboard';
import { OpsAccessDenied, OpsLanding } from '@/components/OpsShell';
import { dashboardTiles, recentAuditLimit } from '@/lib/opsDashboard';
import { holdsOpsRole, opsLandingLinks } from '@/lib/opsNav';
import { recordOpsAccess } from '@/server/db/audit';
import {
  countExperiencesInReview,
  countOpenSupportRequests,
  countRefundFailedBookings,
  countSessionsToday,
  readRecentAuditForOps,
} from '@/server/db/opsDashboard';
import { countOpsPrivateRequests } from '@/server/db/privateRequests';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Operations' };

export default async function OperationsPage() {
  const caller = await readOpsCaller();
  if (!holdsOpsRole(caller.roles)) return <OpsAccessDenied next="/ops" />;

  await recordOpsAccess(caller);
  const [
    inReview,
    refundFailed,
    openSupport,
    privateRequests,
    sessionsToday,
    recentAudit,
  ] = await Promise.all([
    countExperiencesInReview(caller),
    countRefundFailedBookings(caller),
    countOpenSupportRequests(caller),
    countOpsPrivateRequests(caller),
    countSessionsToday(caller),
    readRecentAuditForOps(caller, recentAuditLimit),
  ]);
  return (
    <OpsLanding areas={opsLandingLinks()}>
      <OpsDashboard
        tiles={dashboardTiles({
          inReview,
          refundFailed,
          openSupport,
          privateRequests,
          sessionsToday,
        })}
        recentAudit={recentAudit}
      />
    </OpsLanding>
  );
}
