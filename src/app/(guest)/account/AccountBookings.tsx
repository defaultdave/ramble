import Link from 'next/link';
import { BookingListRow } from '@/components/BookingListRow';
import { PageHeading } from '@/components/PageHeading';
import type {
  AccountBookingView,
  AccountBookingsView,
} from '@/lib/accountBookings';
import { browsePath } from '@/lib/paths';
import styles from './AccountBookings.module.css';

function BookingGroup({
  heading,
  bookings,
}: {
  heading: string;
  bookings: readonly AccountBookingView[];
}) {
  if (bookings.length === 0) return null;
  return (
    <section aria-labelledby={`${heading}-heading`}>
      <h2 id={`${heading}-heading`} className={styles.heading}>
        {heading}
      </h2>
      <ul className={styles.list}>
        {bookings.map((booking) => (
          <BookingListRow
            key={booking.id}
            title={booking.experienceName}
            details={[
              booking.whenLabel,
              `${booking.statusLabel} · ${booking.reference}`,
            ]}
            href={booking.manageHref}
            linkLabel="Manage booking"
            linkHint={booking.reference}
          />
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
  return (
    <>
      <PageHeading title={title} />
      <div className={styles.body}>
        {view.empty ? (
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
