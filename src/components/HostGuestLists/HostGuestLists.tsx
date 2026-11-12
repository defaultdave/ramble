import { BookingListRow } from '@/components/BookingListRow';
import { PageHeading } from '@/components/PageHeading';
import { SearchField } from '@/components/SearchField';
import { hostBookingsPath } from '@/lib/hostGuestLists';
import type {
  HostBookingListItemView,
  HostBookingListView,
} from '@/lib/hostGuestLists';
import styles from './HostGuestLists.module.css';

export const hostBookingsTitle = 'Bookings';

function BookingRow({ row }: { row: HostBookingListItemView }) {
  return (
    <BookingListRow
      title={row.guestName}
      details={[
        `${row.experienceName} · ${row.whenLabel}`,
        `${row.seatsLabel} · ${row.statusLabel} · ${row.reference}`,
      ]}
      href={row.guestListHref}
      linkLabel="Guest list for this session"
    />
  );
}

/** The host's bookings, searched by reference or lead guest's name with a plain GET form, so it works without script. */
export function HostGuestLists({ view }: { view: HostBookingListView }) {
  return (
    <>
      <PageHeading title={hostBookingsTitle} />
      <div className={styles.body}>
        <SearchField
          path={hostBookingsPath}
          query={view.term === '' ? {} : { q: view.term }}
          value={view.term}
          label="Search bookings"
          placeholder="Booking reference or guest name"
        />
        <p className={styles.summary} role="status">
          {view.summary}
        </p>
        {view.rows.length === 0 ? null : (
          <ul className={styles.list}>
            {view.rows.map((row) => (
              <BookingRow key={row.id} row={row} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
