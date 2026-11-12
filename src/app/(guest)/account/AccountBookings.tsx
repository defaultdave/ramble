import Link from 'next/link';
import { PageHeading } from '@/components/PageHeading';
import type {
  AccountBookingView,
  AccountBookingsView,
} from '@/lib/accountBookings';
import { browsePath } from '@/lib/paths';
import styles from './AccountBookings.module.css';

function BookingRow({ booking }: { booking: AccountBookingView }) {
  return (
    <li className={styles.row}>
      <p className={styles.primary}>{booking.experienceName}</p>
      <p className={styles.secondary}>{booking.whenLabel}</p>
      <p className={styles.secondary}>
        {booking.statusLabel} · {booking.reference}
      </p>
      <Link href={booking.manageHref} className={styles.link}>
        Manage booking{' '}
        <span className={styles.visuallyHidden}>{booking.reference}</span>
      </Link>
    </li>
  );
}

function BookingGroup({
  heading,
  bookings,
}: {
  heading: string;
  bookings: readonly AccountBookingView[];
}) {
  if (bookings.length === 0) return null;
  return (
    <section aria-labelledby={`${heading}-heading`} className={styles.group}>
      <h2 id={`${heading}-heading`} className={styles.heading}>
        {heading}
      </h2>
      <ul className={styles.list}>
        {bookings.map((booking) => (
          <BookingRow key={booking.id} booking={booking} />
        ))}
      </ul>
    </section>
  );
}

/** A signed-in guest's bookings, upcoming and then past, each linking to its manage page. */
export function AccountBookings({
  title,
  view,
}: {
  title: string;
  view: AccountBookingsView;
}) {
  const empty = view.upcoming.length === 0 && view.past.length === 0;
  return (
    <>
      <PageHeading title={title} />
      <div className={styles.body}>
        {empty ? (
          <p>
            You have no bookings yet.{' '}
            <Link href={browsePath}>Find something to do</Link>
          </p>
        ) : (
          <>
            <BookingGroup heading="Upcoming" bookings={view.upcoming} />
            <BookingGroup heading="Past" bookings={view.past} />
          </>
        )}
      </div>
    </>
  );
}
