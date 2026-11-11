'use server';

import { redirect } from 'next/navigation';
import {
  agreementNotice,
  hostPath,
  hostsPath,
  inviteNotice,
  newHostPath,
  noticeHref,
  parseHostCreateForm,
  parseHostEditForm,
  parseHostIdField,
} from '@/lib/hostSetup';
import { holdsOpsRole } from '@/lib/opsNav';
import type { Caller } from '@/server/auth/caller';
import { createHost, updateHost } from '@/server/db/hostSetup';
import { recordHostAcceptance } from '@/server/db/legal';
import { inviteHostOwner } from '@/server/hostInvite';
import { readOpsCaller } from '@/server/opsCaller';

// Each action sends the person on with `redirect`, which works by throwing, so none is wrapped in
// a try. The ops list page shows the refusal to anyone without the role, so that is where a
// caller without it is sent, and nothing about the request is said.
async function opsCallerOrLeave(): Promise<Caller> {
  const caller = await readOpsCaller();
  if (!holdsOpsRole(caller.roles)) redirect(hostsPath);
  return caller;
}

function hostIdOrLeave(formData: FormData): string {
  const hostId = parseHostIdField(formData.get('hostId'));
  if (hostId === null) redirect(hostsPath);
  return hostId;
}

export async function createHostAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave();
  const parsed = parseHostCreateForm((name) => formData.get(name));
  if (!parsed.ok) redirect(noticeHref(newHostPath, 'invalid', parsed.fields));

  const created = await createHost(caller, parsed.value);
  if (created.status !== 'created') {
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
  const caller = await opsCallerOrLeave();
  const hostId = hostIdOrLeave(formData);
  const parsed = parseHostEditForm((name) => formData.get(name));
  if (!parsed.ok) {
    redirect(noticeHref(hostPath(hostId), 'invalid', parsed.fields));
  }
  const result = await updateHost(caller, hostId, parsed.value);
  if (result.status === 'not_found') redirect(hostsPath);
  redirect(noticeHref(hostPath(hostId), result.status));
}

export async function acceptHostAgreementAction(
  formData: FormData,
): Promise<void> {
  const caller = await opsCallerOrLeave();
  const hostId = hostIdOrLeave(formData);
  const outcome = await recordHostAcceptance(
    caller,
    hostId,
    parseHostIdField(formData.get('legalDocumentId')),
  );
  if (outcome === 'not_found') redirect(hostsPath);
  redirect(noticeHref(hostPath(hostId), agreementNotice(outcome)));
}

export async function resendHostInviteAction(
  formData: FormData,
): Promise<void> {
  const caller = await opsCallerOrLeave();
  const hostId = hostIdOrLeave(formData);
  const ownerUserId = parseHostIdField(formData.get('ownerUserId'));
  if (ownerUserId === null) redirect(hostPath(hostId));
  const invite = await inviteHostOwner(caller, hostId, ownerUserId);
  redirect(noticeHref(hostPath(hostId), inviteNotice(invite, false)));
}
