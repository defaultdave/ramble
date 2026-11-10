import type { Metadata } from 'next';
import { OpsAccessDenied, OpsLanding } from '@/components/OpsShell';
import { holdsOpsRole, opsLandingLinks } from '@/lib/opsNav';
import { readOpsCaller } from '@/server/opsCaller';
import { recordOpsAccess } from '@/server/db/audit';

export const metadata: Metadata = { title: 'Operations' };

export default async function OperationsPage() {
  const caller = await readOpsCaller();
  if (!holdsOpsRole(caller.roles)) return <OpsAccessDenied next="/ops" />;

  await recordOpsAccess(caller);
  return <OpsLanding areas={opsLandingLinks()} />;
}
