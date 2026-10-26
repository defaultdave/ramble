import { isAllowlisted } from './address';
import type { EmailAdapterName } from './message';

export const emailModes = ['sink', 'allowlist', 'live'] as const;
export type EmailMode = (typeof emailModes)[number];

type RouteInput = {
  mode: EmailMode;
  provider: EmailAdapterName;
  allowlist: readonly string[];
  to: string;
};

/**
 * Which adapter carries a message. The fake adapter is the dev mailbox: nothing leaves the process.
 * `sink` keeps every message there, `allowlist` lets only listed recipients out, `live` lets all out.
 */
export function chooseAdapter({
  mode,
  provider,
  allowlist,
  to,
}: RouteInput): EmailAdapterName {
  switch (mode) {
    case 'sink':
      return 'fake';
    case 'allowlist':
      return isAllowlisted(to, allowlist) ? provider : 'fake';
    case 'live':
      return provider;
  }
}
