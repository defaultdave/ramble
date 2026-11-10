import { AccountControl } from '@/components/Header/AccountControl';
import { PageHeading } from '@/components/PageHeading';
import { classNames } from '@/lib/classNames';
import type {
  HostBookingRowView,
  HostDashboardView,
  HostSessionRowView,
} from '@/lib/hostDashboard';
import styles from './HostDashboard.module.css';

export const hostDashboardTitle = 'Host dashboard';

const statusClass = {
  open: undefined,
  'few-left': styles.fewLeft,
  'sold-out': styles.soldOut,
} as const satisfies Record<HostSessionRowView['status'], string | undefined>;

function SessionRow({ row }: { row: HostSessionRowView }) {
  return (
    <li className={classNames(styles.row, statusClass[row.status])}>
      <p className={styles.primary}>{row.experienceName}</p>
      <p className={styles.secondary}>{row.whenLabel}</p>
      <p className={styles.sold}>{row.soldLabel}</p>
      {/* The words above say the same; the bar is only a picture of them. */}
      <span className={styles.track} aria-hidden="true">
        <span
          className={styles.fill}
          data-fill={String(Math.floor(row.soldPercent / 10))}
        />
      </span>
    </li>
  );
}

function BookingRow({ row }: { row: HostBookingRowView }) {
  return (
    <li className={styles.row}>
      <p className={styles.primary}>{row.guestName}</p>
      <p className={styles.secondary}>
        {row.experienceName} · {row.whenLabel}
      </p>
      <p className={styles.secondary}>
        {row.seatsLabel} · {row.totalLabel} · {row.statusLabel} ·{' '}
        {row.reference}
      </p>
    </li>
  );
}

/** The host's home: the next sessions with seats sold against what each holds, and the latest bookings. */
export function HostDashboard({ view }: { view: HostDashboardView }) {
  return (
    <>
      <PageHeading title={hostDashboardTitle}>
        <p>{view.hostName}</p>
        <AccountControl signedIn />
      </PageHeading>
      <div className={styles.sections}>
        <section aria-labelledby="host-upcoming">
          <h2 id="host-upcoming" className={styles.heading}>
            Upcoming sessions
          </h2>
          {view.sessions.length === 0 ? (
            <p className={styles.empty}>No sessions are scheduled yet.</p>
          ) : (
            <ul className={styles.list}>
              {view.sessions.map((row) => (
                <SessionRow key={row.id} row={row} />
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="host-bookings">
          <h2 id="host-bookings" className={styles.heading}>
            Recent bookings
          </h2>
          {view.bookings.length === 0 ? (
            <p className={styles.empty}>No bookings yet.</p>
          ) : (
            <ul className={styles.list}>
              {view.bookings.map((row) => (
                <BookingRow key={row.id} row={row} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
