'use server';

import { redirect } from 'next/navigation';
import {
  agreementNotice,
  hostPath,
  hostsPath,
  inviteNotice,
  newHostPath,
  parseHostCreateForm,
  parseHostEditForm,
} from '@/lib/hostSetup';
import { noticeHref, parseIdField } from '@/lib/opsForm';
import { createHost, updateHost } from '@/server/db/hostSetup';
import { recordHostAcceptance } from '@/server/db/legal';
import { inviteHostOwner } from '@/server/hostInvite';
import { opsCallerOrLeave } from '@/server/opsAccess';

function hostIdOrLeave(formData: FormData): string {
  const hostId = parseIdField(formData.get('hostId'));
  if (hostId === null) redirect(hostsPath);
  return hostId;
}

export async function createHostAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(hostsPath);
  const parsed = parseHostCreateForm((name) => formData.get(name));
  if (!parsed.ok) redirect(noticeHref(newHostPath, 'invalid', parsed.fields));

  const created = await createHost(caller, parsed.value);
  if (created.status === 'slug_taken') {
    redirect(noticeHref(newHostPath, 'slug_taken', ['slug']));
  }
  if (created.status === 'agreement_refused') {
    redirect(noticeHref(newHostPath, agreementNotice(created.reason)));
  }
  const invite = await inviteHostOwner(
    caller,
    created.hostId,
    created.ownerUserId,
  );
  redirect(noticeHref(hostPath(created.hostId), inviteNotice(invite, true)));
}

export async function updateHostAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(hostsPath);
  const hostId = hostIdOrLeave(formData);
  const parsed = parseHostEditForm((name) => formData.get(name));
  if (!parsed.ok) {
    redirect(noticeHref(hostPath(hostId), 'invalid', parsed.fields));
  }
  const result = await updateHost(caller, hostId, parsed.value);
  if (result.status === 'not_found') redirect(hostsPath);
  if (result.status === 'slug_taken') {
    redirect(noticeHref(hostPath(hostId), 'slug_taken', ['slug']));
  }
  redirect(noticeHref(hostPath(hostId), result.status));
}

export async function acceptHostAgreementAction(
  formData: FormData,
): Promise<void> {
  const caller = await opsCallerOrLeave(hostsPath);
  const hostId = hostIdOrLeave(formData);
  const outcome = await recordHostAcceptance(
    caller,
    hostId,
    parseIdField(formData.get('legalDocumentId')),
  );
  if (outcome === 'not_found') redirect(hostsPath);
  redirect(noticeHref(hostPath(hostId), agreementNotice(outcome)));
}

export async function resendHostInviteAction(
  formData: FormData,
): Promise<void> {
  const caller = await opsCallerOrLeave(hostsPath);
  const hostId = hostIdOrLeave(formData);
  const ownerUserId = parseIdField(formData.get('ownerUserId'));
  if (ownerUserId === null) redirect(hostPath(hostId));
  const invite = await inviteHostOwner(caller, hostId, ownerUserId);
  redirect(noticeHref(hostPath(hostId), inviteNotice(invite, false)));
}
