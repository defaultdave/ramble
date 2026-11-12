import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import { HostDetailView } from '@/components/HostSetup';
import { OpsAccessDenied } from '@/components/OpsShell';
import { PageHeading } from '@/components/PageHeading';
import {
  hostFormFields,
  hostNoticeCodes,
  hostNotices,
  hostPath,
  hostsPath,
} from '@/lib/hostSetup';
import {
  noticeText,
  parseIdField,
  parseNotice,
  parseProblemFields,
} from '@/lib/opsForm';
import { holdsOpsRole } from '@/lib/opsNav';
import {
  acceptHostAgreementAction,
  resendHostInviteAction,
  updateHostAction,
} from '@/server/actions/hosts';
import { readHostForOps } from '@/server/db/hostSetup';
import { readOpsCaller } from '@/server/opsCaller';

export const metadata: Metadata = { title: 'Host' };

export default async function HostPage({
  params,
  searchParams,
}: PageProps<'/ops/hosts/[id]'>) {
  const [{ id }, query, caller] = await Promise.all([
    params,
    searchParams,
    readOpsCaller(),
  ]);
  if (!holdsOpsRole(caller.roles)) {
    return <OpsAccessDenied next={hostPath(id)} />;
  }

  const hostId = parseIdField(id);
  const detail = hostId === null ? null : await readHostForOps(caller, hostId);
  if (detail === null) notFound();

  return (
    <PageHeading title={detail.host.name}>
      <p>
        <Link href={hostsPath}>Back to the hosts</Link>
      </p>
      <ActionNotice
        notice={noticeText(
          hostNotices,
          parseNotice(query.notice, hostNoticeCodes),
        )}
      />
      <HostDetailView
        detail={detail}
        problems={parseProblemFields(query.fields, hostFormFields)}
        actions={{
          save: updateHostAction,
          accept: acceptHostAgreementAction,
          resendInvite: resendHostInviteAction,
        }}
      />
    </PageHeading>
  );
}
