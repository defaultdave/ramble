import { CalendarPlus, Check, MapPin, Ticket } from 'lucide-react';
import { Alert } from '@/components/Alert';
import { ButtonLink } from '@/components/Button';
import {
  OrderStatusPoller,
  type CheckOrderStatus,
} from '@/components/OrderStatusPoller';
import type { OrderPageView, OrderReceipt } from '@/lib/orderReceipt';
import { browsePath } from '@/lib/routes';
import styles from './OrderConfirmation.module.css';

export type OrderConfirmationProps = {
  view: OrderPageView;
  /** The order token the poller asks with; read only for a pending order. */
  token: string;
  /** `getOrderStatus`, for the pending state's poller. */
  checkStatus: CheckOrderStatus;
};

export function OrderConfirmation({
  view,
  token,
  checkStatus,
}: OrderConfirmationProps) {
  switch (view.kind) {
    case 'confirmed':
      return <Receipt receipt={view.receipt} />;
    case 'pending':
      return (
        <div className={styles.page}>
          <h1 className={styles.heading}>Almost there</h1>
          <p className={styles.sub}>
            Confirmation {view.reference} · {view.experienceName}
          </p>
          <OrderStatusPoller
            reference={view.reference}
            token={token}
            check={checkStatus}
          />
        </div>
      );
    case 'notice':
      return (
        <div className={styles.page}>
          <h1 className={styles.heading}>Booking {view.reference}</h1>
          <Alert
            tone={view.notice.tone}
            title={view.notice.title}
            body={view.notice.body}
          />
          {view.notice.action ? (
            <ButtonLink href={view.notice.action.href} variant="secondary">
              {view.notice.action.label}
            </ButtonLink>
          ) : null}
        </div>
      );
    default:
      throw new RangeError(
        `Unknown order page: ${String(view satisfies never)}`,
      );
  }
}

function Receipt({ receipt }: { receipt: OrderReceipt }) {
  return (
    <div className={styles.page}>
      <div className={styles.badge} aria-hidden="true">
        <Check />
      </div>
      <h1 className={styles.heading}>{receipt.heading}</h1>
      <p className={styles.sub}>Confirmation {receipt.reference}</p>

      <section className={styles.card} aria-labelledby="booking-title">
        <h2 id="booking-title" className={styles.title}>
          {receipt.experienceName}
        </h2>
        <p className={styles.meta}>
          {receipt.dayLabel} · {receipt.timeLabel} · {receipt.partyLabel}
        </p>
        {receipt.durationLabel ? (
          <p className={styles.meta}>{receipt.durationLabel}</p>
        ) : null}
        {receipt.meetingPoint ? (
          <p className={styles.where}>Meet at {receipt.meetingPoint}</p>
        ) : null}
        <div className={styles.actions}>
          <ButtonLink
            href={receipt.calendarUrl}
            external
            variant="secondary"
            iconStart={<CalendarPlus size={18} />}
          >
            Add to Google Calendar
          </ButtonLink>
          <ButtonLink
            href={receipt.icsHref}
            download={receipt.icsFileName}
            variant="secondary"
          >
            Download .ics file
          </ButtonLink>
          {receipt.mapsUrl ? (
            <ButtonLink
              href={receipt.mapsUrl}
              external
              variant="secondary"
              iconStart={<MapPin size={18} />}
            >
              Open in Maps
            </ButtonLink>
          ) : null}
          <ButtonLink
            href={receipt.manageHref}
            variant="secondary"
            iconStart={<Ticket size={18} />}
          >
            Manage booking
          </ButtonLink>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="receipt-title">
        <h2 id="receipt-title" className={styles.title}>
          Receipt
        </h2>
        <dl className={styles.lines}>
          {receipt.lines.map((line, index) => (
            <div key={`${String(index)}-${line.label}`} className={styles.line}>
              <dt>{line.label}</dt>
              <dd>{line.amount}</dd>
            </div>
          ))}
          {receipt.taxLine ? (
            <div className={styles.line}>
              <dt>{receipt.taxLine.label}</dt>
              <dd>{receipt.taxLine.amount}</dd>
            </div>
          ) : null}
          <div className={styles.totalLine}>
            <dt>Total</dt>
            <dd>{receipt.total}</dd>
          </div>
          {receipt.giftApplied ? (
            <div className={styles.line}>
              <dt>Paid with your gift</dt>
              <dd>{receipt.giftApplied}</dd>
            </div>
          ) : null}
          {receipt.charged ? (
            <div className={styles.line}>
              <dt>Charged to your card</dt>
              <dd>{receipt.charged}</dd>
            </div>
          ) : null}
        </dl>
        <p className={styles.fine}>{receipt.sellerOfRecord}</p>
      </section>

      <section className={styles.next} aria-labelledby="next-title">
        <h2 id="next-title" className={styles.title}>
          What happens next
        </h2>
        <ul className={styles.list}>
          <li>Your receipt and calendar file are in your email.</li>
          <li>{receipt.cancellationTerms}</li>
        </ul>
      </section>

      <ButtonLink href={browsePath} variant="primary">
        Explore more experiences
      </ButtonLink>
    </div>
  );
}
