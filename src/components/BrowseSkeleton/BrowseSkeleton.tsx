import { Skeleton } from '@/components/Skeleton';
import styles from './BrowseSkeleton.module.css';

/** The filter chips and the first page of cards, drawn at their final size so the page does not move when they arrive. */
export function BrowseSkeleton() {
  return (
    <div className={styles.skeleton} role="status">
      <span className={styles.visuallyHidden}>Loading experiences</span>
      <div className={styles.filters}>
        <Skeleton kind="text" />
      </div>
      <div className={styles.grid}>
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} kind="card" />
        ))}
      </div>
    </div>
  );
}
