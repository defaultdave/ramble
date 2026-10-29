import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import styles from './ExperienceError.module.css';

export type ExperienceErrorProps = {
  /** The page's own address, which Try again reloads. */
  retryHref: string;
};

/**
 * The error state: the page keeps a heading and says what happened. Try again is a GET form to the
 * same address, so it works with no script and reloads exactly what failed.
 */
export function ExperienceError({ retryHref }: ExperienceErrorProps) {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Experience</h1>
      <Alert
        tone="danger"
        title="We couldn't load this experience"
        body="Something went wrong on our side. Try again in a moment."
      />
      <form className={styles.retry} action={retryHref} method="get">
        <Button type="submit" variant="secondary">
          Try again
        </Button>
      </form>
    </div>
  );
}
