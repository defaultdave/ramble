'use server';

import { redirect } from 'next/navigation';
import { hostAccessFor } from '@/lib/hostAccess';
import { hostSettingsPath } from '@/lib/hostSettings';
import { parseHostSettingsForm } from '@/lib/hostSetup';
import { noticeHref } from '@/lib/opsForm';
import { signInHref } from '@/lib/signIn';
import { getCaller } from '@/server/auth/caller';
import { updateHostSettings } from '@/server/db/hostSettings';

/**
 * Saves the settings of the host the signed-in caller owns. The host is read from the caller's own
 * grant and never from the form, so a posted host id changes nothing. Whoever is not a host owner
 * is sent back to the page, which refuses them without saying the area exists. `redirect` works by
 * throwing, so nothing here is wrapped in a try.
 */
export async function updateHostSettingsAction(
  formData: FormData,
): Promise<void> {
  const caller = await getCaller();
  const access = hostAccessFor(caller);
  if (access.kind === 'signed_out') redirect(signInHref(hostSettingsPath));
  if (access.kind !== 'owner') redirect(hostSettingsPath);

  const parsed = parseHostSettingsForm((name) => formData.get(name));
  if (!parsed.ok) {
    redirect(noticeHref(hostSettingsPath, 'invalid', parsed.fields));
  }
  const result = await updateHostSettings(caller, access.hostId, parsed.value);
  redirect(
    result === 'not_found'
      ? hostSettingsPath
      : noticeHref(hostSettingsPath, result),
  );
}
