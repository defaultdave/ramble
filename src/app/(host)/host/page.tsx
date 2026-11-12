import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { HostDashboard, hostDashboardTitle } from '@/components/HostDashboard';
import { hostDashboardPath } from '@/lib/hostDashboard';
import { hostNavLinks } from '@/lib/hostStaff';
import { signInHref } from '@/lib/signIn';
import { loadHostDashboard } from '@/server/hostDashboard';

export const metadata: Metadata = { title: hostDashboardTitle };

/**
 * Every host page checks the caller itself: a layout is not rendered again on a client navigation,
 * so it cannot be the gate. Nobody signed in goes to sign in and comes back here; anyone signed in
 * who owns no host sees the area's not-found page, which does not say the area exists.
 */
export default async function HostDashboardPage() {
  const result = await loadHostDashboard();
  if (result.status === 'signed_out') redirect(signInHref(hostDashboardPath));
  if (result.status === 'refused') notFound();
  return (
    <HostDashboard view={result.view} links={hostNavLinks(result.canManage)} />
  );
}
