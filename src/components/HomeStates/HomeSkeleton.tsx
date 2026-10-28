import { Skeleton } from '@/components/Skeleton';
import styles from './HomeStates.module.css';

/** The loading state: the hero, then the first row of cards, at their final size. */
export function HomeSkeleton() {
  return (
    <div className={styles.skeleton} role="status">
      <span className={styles.visuallyHidden}>Loading the home page</span>
      <div className={styles.hero} aria-hidden="true">
        <div>
          <Skeleton kind="text" />
        </div>
        <div className={styles.art} />
      </div>
      <div className={styles.search} aria-hidden="true" />
      <div className={styles.cards}>
        <Skeleton kind="card" />
        <Skeleton kind="card" />
        <Skeleton kind="card" />
      </div>
    </div>
  );
}
