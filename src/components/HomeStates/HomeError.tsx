import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import styles from './HomeStates.module.css';

/**
 * The error state: the page keeps its heading and says what happened. Try again is a GET form to
 * the same address, so it works with no script and reloads exactly what failed.
 */
export function HomeError() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Ramble</h1>
      <Alert
        tone="danger"
        title="We couldn't load the home page"
        body="Something went wrong on our side. Try again in a moment."
        action={
          <form className={styles.retry} action="/" method="get">
            <Button type="submit" variant="secondary">
              Try again
            </Button>
          </form>
        }
      />
    </div>
  );
}
