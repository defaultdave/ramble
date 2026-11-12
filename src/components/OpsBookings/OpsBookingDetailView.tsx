import Link from 'next/link';
import { StatusBadge } from '@/components/StatusBadge';
import {
  opsBookingsPath,
  orderStatusLabels,
  orderStatusTones,
  type OpsBookingDetail,
} from '@/lib/opsBookings';
import styles from './OpsBookings.module.css';

/** One booking: who and what, its refunds, and its history. */
export function OpsBookingDetailView({ detail }: { detail: OpsBookingDetail }) {
  const { row } = detail;
  return (
    <div className={styles.stack}>
      <p>
        <Link href={opsBookingsPath}>Back to the bookings</Link>
      </p>
      <dl className={styles.facts}>
        <dt>Status</dt>
        <dd>
          <StatusBadge
            tone={orderStatusTones[row.status]}
            label={orderStatusLabels[row.status]}
          />
        </dd>
        <dt>Guest</dt>
        <dd>{row.guestName}</dd>
        <dt>Email on the booking</dt>
        <dd className={styles.wrap}>{row.email}</dd>
        <dt>Experience</dt>
        <dd>
          {row.experienceName}
          <span className={styles.muted}> {row.whenLabel}</span>
        </dd>
        <dt>Total</dt>
        <dd>{row.totalLabel}</dd>
        <dt>Refunded or on its way</dt>
        <dd>{detail.refundedLabel}</dd>
      </dl>

      <section className={styles.section} aria-labelledby="refunds-heading">
        <h2 id="refunds-heading" className={styles.heading}>
          Refunds
        </h2>
        {detail.refunds.length === 0 ? (
          <p className={styles.muted}>No refunds yet.</p>
        ) : (
          <ul className={styles.list}>
            {detail.refunds.map((refund) => (
              <li key={refund.id} className={styles.row}>
                {refund.amountLabel} · {refund.statusLabel}
                <span className={styles.muted}>
                  {refund.reasonLabel} · {refund.whenLabel}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="history-heading">
        <h2 id="history-heading" className={styles.heading}>
          History
        </h2>
        <ol className={styles.list}>
          {detail.events.map((event) => (
            <li
              key={`${event.whenLabel}-${event.label}`}
              className={styles.row}
            >
              {event.label}
              <span className={styles.muted}>{event.whenLabel}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
