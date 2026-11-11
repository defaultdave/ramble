import Link from 'next/link';
import { PageHeading } from '@/components/PageHeading';
import { hostBookingsPath } from '@/lib/hostGuestLists';
import type { HostGuestListView, HostGuestRowView } from '@/lib/hostGuestLists';
import styles from './HostGuestList.module.css';

export const hostGuestListTitle = 'Guest list';

function GuestRow({ row }: { row: HostGuestRowView }) {
  return (
    <li className={styles.row}>
      <p className={styles.name}>{row.guestName}</p>
      <p className={styles.meta}>
        {row.seatsLabel} · {row.reference}
      </p>
      <dl className={styles.details}>
        <div>
          <dt>Ages</dt>
          <dd>{row.agesLabel}</dd>
        </div>
        <div>
          <dt>Waiver</dt>
          <dd>{row.waiverLabel}</dd>
        </div>
        {row.contacts.map((contact) => (
          <div key={contact.label}>
            <dt>{contact.label}</dt>
            <dd>{contact.value}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

/**
 * One session's guests for the host who runs it, laid out to print for the day. The screen-only
 * parts (the way back, the print hint) drop out of the printed page.
 */
export function HostGuestList({ view }: { view: HostGuestListView }) {
  return (
    <div className={styles.page}>
      <PageHeading title={hostGuestListTitle}>
        <p>
          {view.experienceName} · {view.whenLabel}
        </p>
        <p>{view.hostName}</p>
        <p>{view.totalLabel}</p>
      </PageHeading>
      <div className={styles.body}>
        <p className={styles.screenOnly}>
          <Link href={hostBookingsPath}>Back to bookings</Link>
        </p>
        <p className={styles.screenOnly}>
          To print this list, use your browser&rsquo;s print command.
        </p>
        {view.rows.length === 0 ? (
          <p className={styles.empty}>
            No confirmed bookings for this session.
          </p>
        ) : (
          <ul className={styles.list}>
            {view.rows.map((row) => (
              <GuestRow key={row.id} row={row} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
