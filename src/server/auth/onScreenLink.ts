import 'server-only';
import { signInConfirmHref, signInLinkDelivery } from '@/lib/signIn';
import { holdsAnyRoleGrant } from '@/server/db/roleGrants';
import { env } from '@/server/env';
import { getEmailConfig } from '@/server/ports/email/config';
import { createSignInLinkToken } from './signInLink';
import { sendSignInLinkEmail } from './signInLinkEmail';

/**
 * The sign-in link for an address, as the confirm page's path, when it is to be shown on the page
 * (email in `sink` mode, an address with no role grant); null when Better Auth should send it
 * the usual way. The role grant and the mode are read on every call, so the first query is the same
 * either way; only the work after it differs. The link is also sent, so it is in the dev mailbox as any link is: it is
 * the same single-use, 5 minute link, and a role holder's is never made here at all.
 */
export async function onScreenSignInLink(
  email: string,
  next: string,
): Promise<string | null> {
  const holdsRoleGrant = await holdsAnyRoleGrant(email);
  const { mode } = getEmailConfig();
  if (signInLinkDelivery(mode, holdsRoleGrant) !== 'on_screen') return null;

  const token = await createSignInLinkToken(email);
  await sendSignInLinkEmail(email, token, new URL(env.APP_URL).origin, next);
  return signInConfirmHref(token, next);
}
