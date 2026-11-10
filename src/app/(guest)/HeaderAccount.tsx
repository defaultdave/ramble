import { headers } from 'next/headers';
import { cache } from 'react';
import { AccountControl } from '@/components/Header/AccountControl';
import { readSession } from '@/server/auth/session';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';

// The header and the phone menu each show the control; one request reads the session once.
const isSignedIn = cache(async (requestHeaders: Headers): Promise<boolean> => {
  try {
    return (await readSession(requestHeaders)) !== null;
  } catch (error) {
    rethrowOrLog('The session could not be read for the header', error);
    return false;
  }
});

/**
 * The header's sign-in or sign-out control, which depends on the request's cookie. It renders
 * inside Suspense, so the rest of the shell can still be prerendered. A session that cannot be
 * read shows Sign in: the control is only a label, and every protected route checks the session itself.
 */
export async function HeaderAccount() {
  return <AccountControl signedIn={await isSignedIn(await headers())} />;
}
