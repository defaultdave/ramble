import type { Metadata } from 'next';
import { AuditView } from '@/components/StaffAdmin';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import { holdsOpsRole } from '@/lib/opsNav';
import { auditPath, parseAuditCursor, parseAuditDay } from '@/lib/staffAdmin';
import { readAuditForOps } from '@/server/db/auditView';
import { readOpsCaller } from '@/server/opsCaller';
import { systemClock } from '@/server/ports/clock';

export const metadata: Metadata = { title: 'Audit log' };

export default async function AuditPage({
  searchParams,
}: PageProps<'/ops/audit'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) return <OpsAccessDenied next={auditPath} />;

  const day = parseAuditDay(query.day, systemClock.now());
  const afterId = parseAuditCursor(query.cursor);
  const page = await readAuditForOps(caller, day, afterId);
  return (
    <PageHeading title="Audit log">
      <AuditView
        day={day}
        rows={page.rows}
        query={query}
        cursor={afterId === 0 ? null : String(afterId)}
        nextCursor={page.nextCursor}
      />
    </PageHeading>
  );
}
