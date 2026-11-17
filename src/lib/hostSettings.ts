import { hostAreaResult, type HostAccess } from './hostAccess';
import type { HostSettingsField, HostSettingsInput } from './hostSetup';
import { noticeHref } from './opsForm';
import { signInHref } from './signIn';

export const hostSettingsPath = '/host/settings';

export type HostSettingsResult =
  | { status: 'signed_out' }
  | { status: 'refused' }
  | { status: 'ok'; values: HostSettingsInput };

export type HostSettingsSaveResult = 'updated' | 'unchanged' | 'not_found';

/** Who a save is for, before anything is read from the form: an owner's host, or where to send anyone else (nobody signed in to sign in and back, anyone who owns no host to the page, which refuses them). */
export function hostSettingsGate(
  access: HostAccess,
): { hostId: string } | { next: string } {
  if (access.kind === 'signed_out')
    return { next: signInHref(hostSettingsPath) };
  return access.kind === 'owner'
    ? { hostId: access.hostId }
    : { next: hostSettingsPath };
}

/** Where a save ends: a refused form back with the fields to look at, a save or a form with nothing different back with its notice, a host that is gone back with none. */
export function hostSettingsSaveNext(
  outcome:
    | { status: 'invalid'; fields: readonly HostSettingsField[] }
    | { status: HostSettingsSaveResult },
): string {
  switch (outcome.status) {
    case 'invalid':
      return noticeHref(hostSettingsPath, 'invalid', outcome.fields);
    case 'not_found':
      return hostSettingsPath;
    case 'updated':
    case 'unchanged':
      return noticeHref(hostSettingsPath, outcome.status);
  }
}

/** What the page does with a request; see `hostAreaResult`. */
export function hostSettingsResult(
  access: HostAccess,
  values: HostSettingsInput | null,
): HostSettingsResult {
  return hostAreaResult(access, values, (read) => ({
    status: 'ok',
    values: read,
  }));
}
