import Link from 'next/link';
import { endSessionActionPath, signInPath } from '@/lib/signIn';
import styles from './Header.module.css';

/**
 * Sign in for a visitor, Sign out for a signed-in person. Sign out is a plain form post, so it
 * works with no script and the next page already knows the session is gone.
 */
export function AccountControl({ signedIn }: { signedIn: boolean }) {
  if (!signedIn) {
    return (
      <Link href={signInPath} className={styles.accountControl}>
        Sign in
      </Link>
    );
  }
  return (
    <form action={endSessionActionPath} method="post">
      <button type="submit" className={styles.accountControl}>
        Sign out
      </button>
    </form>
  );
}
