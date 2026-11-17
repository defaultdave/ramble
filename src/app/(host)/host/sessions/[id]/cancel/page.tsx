import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ActionNotice } from '@/components/ActionNotice';
import {
  HostCancelSession,
  hostCancelTitle,
} from '@/components/HostCancelSession';
import { hostCancelNotice } from '@/lib/hostCancelSession';
import { hostCancelPath } from '@/lib/hostSessions';
import { signInHref } from '@/lib/signIn';
import { cancelHostSessionAction } from '@/server/actions/hostCancelSession';
import { loadHostCancel } from '@/server/hostCancelSession';

export const metadata: Metadata = { title: hostCancelTitle };

/**
 * Where a host reads who cancelling a booked session affects, then confirms. Like the rest of the
 * host area the page checks the caller itself: nobody signed in goes to sign in and comes back, and
 * anyone who is not the owner of the session's host (staff, another host, a guest) or names a session
 * that is not there sees the area's not-found page, so the address never says which sessions exist.
 */
export default async function HostCancelSessionPage({
  params,
  searchParams,
}: PageProps<'/host/sessions/[id]/cancel'>) {
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);
  const result = await loadHostCancel(id);
  if (result.status === 'signed_out') redirect(signInHref(hostCancelPath(id)));
  if (result.status === 'refused') notFound();
  return (
    <>
      <ActionNotice notice={hostCancelNotice(notice)} />
      <HostCancelSession view={result.view} action={cancelHostSessionAction} />
    </>
  );
}
