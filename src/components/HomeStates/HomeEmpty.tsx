import Link from 'next/link';
import { browsePath } from '@/lib/routes';
import styles from './HomeStates.module.css';

/** What the page shows when no home module is switched on, so it is never a bare header and footer. */
export function HomeEmpty() {
  return (
    <div className={styles.page}>
      <div className={styles.pageInner}>
        <h1 className={styles.title}>Ramble</h1>
        <p className={styles.text}>
          We are still putting the home page together. Everything that is on is
          a click away.
        </p>
        <Link className={styles.link} href={browsePath}>
          Browse experiences
        </Link>
      </div>
    </div>
  );
}
