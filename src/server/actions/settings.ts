'use server';

import { redirect } from 'next/navigation';
import {
  parseSettingsForm,
  settingsPath,
  settingsSaveNext,
  settingsSaveOutcome,
} from '@/lib/opsSettings';
import { updateSettings } from '@/server/db/settings';
import { opsCallerOrLeave } from '@/server/opsAccess';

/**
 * Saves the six settings the page shows. Anyone without the ops role is sent to the page, which
 * refuses them. A refused form changes nothing. `redirect` works by throwing, so nothing here is
 * wrapped in a try.
 */
export async function updateSettingsAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(settingsPath);
  const parsed = parseSettingsForm((name) => formData.get(name));
  if (!parsed.ok) {
    redirect(settingsSaveNext({ status: 'invalid', fields: parsed.fields }));
  }
  const saved = await updateSettings(caller, parsed.value);
  redirect(settingsSaveNext({ status: settingsSaveOutcome(saved.changed) }));
}
