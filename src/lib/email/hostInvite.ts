import { z } from 'zod';
import { hostLimits } from '../hostSetup';
import { signInLinkData, signInPath } from '../signIn';
import { oneLineClipped } from '../text';

// The email that tells a new host owner they have been set up and carries their first sign-in link.

const hostInviteHostNameMaxChars = hostLimits.name;

export const HostInviteDataSchema = z.object({
  hostName: z.string().min(1).max(hostInviteHostNameMaxChars),
  /** The sign-in link: a Ramble page that asks for a click before it uses the token. */
  url: z.url({ protocol: /^https?$/ }).max(2048),
  /** The page to ask for a new link once this one has lapsed. */
  signInUrl: z.url({ protocol: /^https?$/ }).max(2048),
  expiresInMinutes: z.int().min(1).max(60),
});

export type HostInviteData = z.infer<typeof HostInviteDataSchema>;

/** The host's name sits in the subject, so it is cut to one line. */
export function hostInviteSubject(data: HostInviteData): string {
  return `You are set up on Ramble: ${oneLineClipped(data.hostName, hostInviteHostNameMaxChars)}`;
}

/** The owner lands on the host area after signing in. */
export const hostInviteLandingPath = '/host';

export function hostInviteData(
  hostName: string,
  token: string,
  appOrigin: string,
): HostInviteData {
  return {
    hostName,
    ...signInLinkData(token, appOrigin, hostInviteLandingPath),
    signInUrl: new URL(signInPath, appOrigin).toString(),
  };
}
