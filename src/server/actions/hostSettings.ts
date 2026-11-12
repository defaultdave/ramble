'use server';

import { redirect } from 'next/navigation';
import { hostAccessFor } from '@/lib/hostAccess';
import { hostSettingsGate, hostSettingsSaveNext } from '@/lib/hostSettings';
import { parseHostSettingsForm } from '@/lib/hostSetup';
import { getCaller } from '@/server/auth/caller';
import { updateHostSettings } from '@/server/db/hostSettings';

/**
 * Saves the settings of the host the signed-in caller owns. The host is read from the caller's own
 * grant and never from the form, so a posted host id changes nothing. `redirect` works by
 * throwing, so nothing here is wrapped in a try.
 */
export async function updateHostSettingsAction(
  formData: FormData,
): Promise<void> {
  const caller = await getCaller();
  const gate = hostSettingsGate(hostAccessFor(caller));
  if ('next' in gate) redirect(gate.next);

  const parsed = parseHostSettingsForm((name) => formData.get(name));
  if (!parsed.ok) {
    redirect(
      hostSettingsSaveNext({ status: 'invalid', fields: parsed.fields }),
    );
  }
  const status = await updateHostSettings(caller, gate.hostId, parsed.value);
  redirect(hostSettingsSaveNext({ status }));
}
