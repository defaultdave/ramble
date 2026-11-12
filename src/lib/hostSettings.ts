import type { HostAccess } from './hostAccess';
import type { HostSettingsInput } from './hostSetup';

export const hostSettingsPath = '/host/settings';

export type HostSettingsResult =
  | { status: 'signed_out' }
  | { status: 'refused' }
  | { status: 'ok'; values: HostSettingsInput };

/**
 * What the page does with a request: nobody signed in is told to sign in; anyone else who is not
 * a host owner is refused, as is an owner whose host no longer exists (`values` null).
 */
export function hostSettingsResult(
  access: HostAccess,
  values: HostSettingsInput | null,
): HostSettingsResult {
  if (access.kind === 'signed_out') return { status: 'signed_out' };
  if (access.kind === 'not_a_host_owner' || values === null) {
    return { status: 'refused' };
  }
  return { status: 'ok', values };
}
