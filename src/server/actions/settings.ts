'use server';

import { redirect } from 'next/navigation';
import {
  parseSettingsForm,
  parseSettingsVersion,
  StaleSettingsError,
  settingsPath,
  settingsSaveNext,
  settingsSaveOutcome,
} from '@/lib/opsSettings';
import { updateSettings } from '@/server/db/settings';
import { opsCallerOrLeave } from '@/server/opsAccess';

/**
 * Saves the six settings the page shows. Anyone without the ops role is sent to the page, which
 * refuses them. A refused form, or one opened before the settings last changed, changes nothing. `redirect` works by throwing, so nothing here is
 * wrapped in a try.
 */
export async function updateSettingsAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(settingsPath);
  const version = parseSettingsVersion((name) => formData.get(name));
  const parsed = parseSettingsForm((name) => formData.get(name));
  if (!parsed.ok) {
    redirect(settingsSaveNext({ status: 'invalid', fields: parsed.fields }));
  }
  const saved = await updateSettings(caller, parsed.value, version).catch(
    (error: unknown) => {
      if (error instanceof StaleSettingsError) return null;
      throw error;
    },
  );
  redirect(
    settingsSaveNext({
      status: saved === null ? 'stale' : settingsSaveOutcome(saved.changed),
    }),
  );
}
