import { Button } from '@/components/Button';
import { confirmSignInActionPath } from '@/lib/signIn';
import styles from './SignIn.module.css';

export type ConfirmSignInProps = { token: string; next: string };

/**
 * The page an emailed link opens. It only shows a button: the link is used by the post, never by
 * opening the page, so a mail scanner that fetches the address cannot use it up.
 */
export function ConfirmSignIn({ token, next }: ConfirmSignInProps) {
  return (
    <div className={styles.stack}>
      <p>Press the button to finish signing in on this device.</p>
      <form action={confirmSignInActionPath} method="post">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="next" value={next} />
        <Button type="submit" size="lg">
          Sign in
        </Button>
      </form>
    </div>
  );
}
