import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionNotice } from '@/components/ActionNotice';
import { HostForm } from '@/components/HostSetup';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import {
  hostFormFields,
  hostNoticeCodes,
  hostNotices,
  hostsPath,
  newHostPath,
} from '@/lib/hostSetup';
import { noticeText, parseNotice, parseProblemFields } from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import { createHostAction } from '@/server/actions/hosts';
import { readNewHostForm } from '@/server/db/hostSetup';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Add a host' };

export default async function NewHostPage({
  searchParams,
}: PageProps<'/ops/hosts/new'>) {
  const [query, caller] = await Promise.all([searchParams, readOpsCaller()]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={newHostPath} />;
  }

  const agreement = await readNewHostForm(caller);
  return (
    <PageHeading title="Add a host">
      <p>
        <Link href={hostsPath}>Back to the hosts</Link>
      </p>
      <ActionNotice
        notice={noticeText(
          hostNotices,
          parseNotice(query.notice, hostNoticeCodes),
        )}
      />
      <HostForm
        action={createHostAction}
        problems={parseProblemFields(query.fields, hostFormFields)}
        agreement={agreement}
      />
    </PageHeading>
  );
}
