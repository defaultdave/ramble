import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { HostGuestList, hostGuestListTitle } from '@/components/HostGuestList';
import { hostGuestListHref } from '@/lib/hostGuestLists';
import { signInHref } from '@/lib/signIn';
import { loadHostGuestList } from '@/server/hostGuestLists';

export const metadata: Metadata = { title: hostGuestListTitle };

/**
 * A session that is missing, is not a session id, or is another host's all end in the area's
 * not-found page, so the address never says which sessions exist.
 */
export default async function HostGuestListPage({
  params,
}: PageProps<'/host/bookings/session/[sessionId]'>) {
  const { sessionId } = await params;
  const result = await loadHostGuestList(sessionId);
  if (result.status === 'signed_out') {
    redirect(signInHref(hostGuestListHref(sessionId)));
  }
  if (result.status === 'refused') notFound();
  return <HostGuestList view={result.view} />;
}
