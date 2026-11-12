import { redirect } from 'next/navigation';
import { accountPath } from '@/lib/routes';
import { signInHref } from '@/lib/signIn';
import { loadAccountBookings } from '@/server/accountBookings';
import { AccountBookings } from './AccountBookings';

export const accountTitle = 'My bookings';

/**
 * The page checks the caller itself: a layout is not rendered again on a client navigation, so it
 * cannot be the gate. Nobody signed in goes to sign in and comes back here.
 */
export async function AccountContent() {
  const result = await loadAccountBookings();
  if (result.status === 'signed_out') redirect(signInHref(accountPath));
  return <AccountBookings title={accountTitle} view={result.view} />;
}
