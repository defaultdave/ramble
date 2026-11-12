import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { HostSettings, hostSettingsTitle } from '@/components/HostSettings';
import { hostSettingsPath } from '@/lib/hostSettings';
import { hostPageNotice, hostSettingsFields } from '@/lib/hostSetup';
import { parseProblemFields } from '@/lib/opsForm';
import { signInHref } from '@/lib/signIn';
import { updateHostSettingsAction } from '@/server/actions/hostSettings';
import { loadHostSettings } from '@/server/hostSettings';

export const metadata: Metadata = { title: hostSettingsTitle };

/** The same gate as the dashboard: sign in first, and anyone who owns no host sees the area's not-found page. */
export default async function HostSettingsPage({
  searchParams,
}: PageProps<'/host/settings'>) {
  const query = await searchParams;
  const result = await loadHostSettings();
  if (result.status === 'signed_out') redirect(signInHref(hostSettingsPath));
  if (result.status === 'refused') notFound();
  return (
    <HostSettings
      values={result.values}
      action={updateHostSettingsAction}
      notice={hostPageNotice(query.notice)}
      problems={parseProblemFields(query.fields, hostSettingsFields)}
    />
  );
}
