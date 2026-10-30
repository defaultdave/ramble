import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { classNames } from '@/lib/classNames';
import {
  upcomingSessionLimits,
  type SessionRowView,
  type UpcomingSessionsView,
} from '@/lib/upcomingSessions';
import styles from './UpcomingSessions.module.css';

const statusClass = {
  open: undefined,
  'few-left': styles.fewLeft,
  'sold-out': styles.soldOut,
} satisfies Record<SessionRowView['status'], string | undefined>;

function RowContent({ row }: { row: SessionRowView }) {
  return (
    <>
      <span className={styles.text}>
        <span className={styles.when}>
          {row.dayLabel} · {row.timeLabel}
        </span>
        <span className={styles.spaces}>{row.spacesLabel}</span>
      </span>
      {row.href === null ? null : (
        <span className={styles.end}>
          {row.priceLabel === null ? null : (
            <span className={styles.price}>{row.priceLabel}</span>
          )}
          <ChevronRight className={styles.chevron} aria-hidden="true" />
        </span>
      )}
    </>
  );
}

function Row({ row }: { row: SessionRowView }) {
  const className = classNames(
    styles.row,
    statusClass[row.status],
    row.selected ? styles.selected : undefined,
  );
  const current = row.selected ? ('date' as const) : undefined;
  return row.href === null ? (
    <div className={className} aria-current={current}>
      <RowContent row={row} />
    </div>
  ) : (
    <Link
      href={row.href}
      className={classNames(className, styles.link)}
      aria-current={current}
    >
      <RowContent row={row} />
    </Link>
  );
}

export type UpcomingSessionsProps = { view: UpcomingSessionsView };

/**
 * The next dates of an experience, one row each with its time on the host's clock and the spaces
 * left. A sold-out date stays in the list, marked and without a link. The heading is the page's.
 */
export function UpcomingSessions({ view }: UpcomingSessionsProps) {
  if (view.kind === 'none') {
    return (
      <p className={styles.empty}>
        No dates are open right now. Check back soon.
      </p>
    );
  }
  return (
    <ul className={styles.list} role="list">
      {view.rows.map((row) => (
        <li key={row.id}>
          <Row row={row} />
        </li>
      ))}
    </ul>
  );
}

/** The rows at their final height, so the page below does not move when the dates arrive. */
export function UpcomingSessionsSkeleton() {
  return (
    <div role="status">
      <span className={styles.visuallyHidden}>Loading dates</span>
      <ul className={styles.list} role="list" aria-hidden="true">
        {Array.from({ length: upcomingSessionLimits.maxRows }, (_, index) => (
          <li key={index} className={styles.row}>
            <span className={styles.text}>
              <span className={classNames(styles.bar, styles.barWhen)} />
              <span className={classNames(styles.bar, styles.barSpaces)} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type UpcomingSessionsErrorProps = {
  /** The page's own address, which Try again reloads. */
  retryHref: string;
};

/** The dates could not be read: the rest of the page stays, and the guest can retry with no script. */
export function UpcomingSessionsError({
  retryHref,
}: UpcomingSessionsErrorProps) {
  return (
    <div className={styles.errorBox}>
      <Alert
        tone="danger"
        title="We couldn't load the dates"
        body="Something went wrong on our side. Try again in a moment."
      />
      <form action={retryHref} method="get">
        <Button type="submit" variant="secondary">
          Check availability
        </Button>
      </form>
    </div>
  );
}
