import styles from './BookingPanelSkeleton.module.css';

/** The panel at the height it has with nothing chosen, so the column does not move when the dates arrive (PRD-68). */
export function BookingPanelSkeleton() {
  return (
    <div role="status" className={styles.skeleton}>
      <span className={styles.hidden}>Loading booking options</span>
      <div className={styles.body} aria-hidden="true">
        <span className={styles.price} />
        <span className={styles.calendar} />
        <span className={styles.action} />
      </div>
    </div>
  );
}
