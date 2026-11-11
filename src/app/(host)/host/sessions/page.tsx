import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { HostSessions, hostSessionsTitle } from '@/components/HostSessions';
import { hostSessionsPath } from '@/lib/hostSessions';
import { signInHref } from '@/lib/signIn';
import {
  addOneOffSessionAction,
  cancelSessionAction,
  publishWeekAction,
  updateSessionCapacityAction,
  updateSessionPriceAction,
  updateSessionTimeAction,
} from '@/server/actions/hostSessions';
import { loadHostWeek } from '@/server/hostSessions';

export const metadata: Metadata = { title: hostSessionsTitle };

const actions = {
  publishWeek: publishWeekAction,
  updateCapacity: updateSessionCapacityAction,
  updateTime: updateSessionTimeAction,
  updatePrice: updateSessionPriceAction,
  cancelSession: cancelSessionAction,
  addOneOff: addOneOffSessionAction,
};

/**
 * The week comes from the address (`?week=`, any date in it); the host never does. Like the
 * dashboard, the page checks the caller itself: nobody signed in goes to sign in and comes back,
 * and anyone signed in who owns no host sees the area's not-found page.
 */
export default async function HostSessionsPage({
  searchParams,
}: PageProps<'/host/sessions'>) {
  const { week } = await searchParams;
  const result = await loadHostWeek(
    typeof week === 'string' ? week : undefined,
  );
  if (result.status === 'signed_out') redirect(signInHref(hostSessionsPath));
  if (result.status === 'refused') notFound();
  return <HostSessions view={result.view} actions={actions} />;
}
