import { Skeleton } from '@/components/Skeleton';
import { classNames } from '@/lib/classNames';
import styles from './HomeStates.module.css';

const bar = styles.bar;

/**
 * The loading state: the hero, the category row and the first row of Picks, at the sizes and in the
 * order of the loaded page. Its hidden h1 keeps the page a heading while it loads; the loaded
 * page's h1 is the hero headline.
 */
export function HomeSkeleton() {
  return (
    <>
      <h1 className={styles.visuallyHidden}>Ramble</h1>
      <div role="status">
        <span className={styles.visuallyHidden}>Loading the home page</span>
        <div
          className={classNames(styles.band, styles.heroBand)}
          aria-hidden="true"
        >
          <div className={classNames(styles.skeletonInner, styles.heroRow)}>
            <div className={styles.copy}>
              <span className={classNames(bar, styles.eyebrowBar)} />
              <div className={classNames(styles.lines, styles.headingLines)}>
                <span className={bar} />
                <span className={bar} />
                <span className={bar} />
                <span className={bar} />
              </div>
              <div className={classNames(styles.lines, styles.bodyLines)}>
                <span className={bar} />
                <span className={bar} />
                <span className={bar} />
              </div>
              <div className={styles.search}>
                <div className={styles.searchField}>
                  <span className={classNames(bar, styles.labelBar)} />
                  <span className={classNames(bar, styles.controlBar)} />
                </div>
                <div className={styles.searchField}>
                  <span className={classNames(bar, styles.labelBar)} />
                  <span className={classNames(bar, styles.controlBar)} />
                </div>
                <span className={classNames(bar, styles.submitBar)} />
              </div>
            </div>
            <div className={styles.art} />
          </div>
        </div>
        <div className={styles.band} aria-hidden="true">
          <div className={styles.skeletonInner}>
            <span className={classNames(bar, styles.railHeadingBar)} />
            <div className={styles.pills}>
              {Array.from({ length: 8 }, (_, index) => (
                <span key={index} className={classNames(bar, styles.pillBar)} />
              ))}
            </div>
          </div>
        </div>
        <div className={styles.band} aria-hidden="true">
          <div className={classNames(styles.skeletonInner, styles.picksInner)}>
            <div className={styles.picksHead}>
              <span className={classNames(bar, styles.eyebrowBar)} />
              <span className={classNames(bar, styles.picksHeadingBar)} />
              <span className={classNames(bar, styles.summaryBar)} />
            </div>
            <div className={styles.cards}>
              <Skeleton kind="card" />
              <Skeleton kind="card" />
              <Skeleton kind="card" />
            </div>
            <span className={classNames(bar, styles.linkBar)} />
          </div>
        </div>
      </div>
    </>
  );
}
