import { Info } from 'lucide-react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import {
  cancelNotice,
  confirmPath,
  type CancelNotice,
  type ManageBooking as ManageBookingDetails,
  type ManageView,
} from '@/lib/manageBooking';
import { browsePath, contactPath, helpPath } from '@/lib/paths';
import { managePath } from '@/lib/routes';
import styles from './ManageBooking.module.css';

/** `cancelBookingForm`: posts the form's token and shown refund, then sends the guest back to the page. */
export type CancelBookingFormAction = (formData: FormData) => Promise<void>;

export type ManageBookingProps = {
  view: ManageView;
  /** The manage token the page was opened with: the caller's right to cancel. */
  token: string;
  /** The one notice the page shows, from `managePageState`. */
  notice: CancelNotice | null;
  /** The second step: the cancel form, with the refund said again. */
  confirming: boolean;
  cancelAction: CancelBookingFormAction;
};

/**
 * The manage page. It is a server component and works with scripting off: the first step is the
 * page with the refund shown, a link to the second step is `?confirm=1`, and the second step is a
 * form that posts the cancel action.
 */
export function ManageBooking({
  view,
  token,
  notice,
  confirming,
  cancelAction,
}: ManageBookingProps) {
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <p className={styles.eyebrow}>
          From your confirmation email · no account needed
        </p>
        <h1 className={styles.heading}>Your booking</h1>
      </div>

      {notice ? (
        <Alert tone={notice.tone} title={notice.title} body={notice.body} />
      ) : null}

      <BookingCard booking={view.booking} />

      {view.kind === 'active' ? (
        <section className={styles.cancel} aria-labelledby="cancel-title">
          <h2 id="cancel-title" className={styles.subheading}>
            {view.prompt.heading}
          </h2>
          <p className={styles.body}>{view.prompt.body}</p>
          {confirming ? (
            <form
              action={cancelAction}
              className={styles.confirm}
              aria-labelledby="confirm-title"
            >
              <p id="confirm-title" className={styles.confirmTitle}>
                {view.prompt.confirmTitle}
              </p>
              <p className={styles.body}>{view.prompt.confirmBody}</p>
              <input type="hidden" name="manageToken" value={token} />
              <input
                type="hidden"
                name="expectedRefundMinor"
                value={String(view.prompt.refundMinor)}
              />
              <Button type="submit" variant="primary">
                {view.prompt.buttonLabel}
              </Button>
              <ButtonLink href={managePath(token)} variant="secondary">
                {view.prompt.keepLabel}
              </ButtonLink>
            </form>
          ) : (
            <ButtonLink href={confirmPath(token)} variant="secondary">
              {view.prompt.buttonLabel}
            </ButtonLink>
          )}
          {view.prompt.footnote ? (
            <p className={styles.fine}>{view.prompt.footnote}</p>
          ) : null}
        </section>
      ) : null}

      {view.kind === 'cancelled' ? (
        <ButtonLink href={browsePath} variant="secondary">
          Explore more experiences
        </ButtonLink>
      ) : null}

      <p className={styles.help}>
        <Info size={20} aria-hidden="true" />
        <span>
          Need something else? The <a href={helpPath}>help center</a> or{' '}
          <a href={contactPath}>contact us</a>.
        </span>
      </p>
    </div>
  );
}

function BookingCard({ booking }: { booking: ManageBookingDetails }) {
  return (
    <section className={styles.card} aria-labelledby="booking-title">
      <h2 id="booking-title" className={styles.title}>
        {booking.experienceName}
      </h2>
      <p className={styles.meta}>
        {booking.dayLabel} · {booking.timeLabel} · {booking.partyLabel}
      </p>
      <p className={styles.meta}>
        Confirmation {booking.reference} · with {booking.hostName}
      </p>
      {booking.meetingPoint ? (
        <p className={styles.where}>Meet at {booking.meetingPoint}</p>
      ) : null}
      <dl className={styles.lines}>
        {booking.lines.map((line, index) => (
          <div key={`${String(index)}-${line.label}`} className={styles.line}>
            <dt>{line.label}</dt>
            <dd>{line.amount}</dd>
          </div>
        ))}
        {booking.taxLine ? (
          <div className={styles.line}>
            <dt>{booking.taxLine.label}</dt>
            <dd>{booking.taxLine.amount}</dd>
          </div>
        ) : null}
        <div className={styles.totalLine}>
          <dt>{booking.totalLabel}</dt>
          <dd>{booking.total}</dd>
        </div>
        {booking.giftApplied ? (
          <div className={styles.line}>
            <dt>Paid with your gift</dt>
            <dd>{booking.giftApplied}</dd>
          </div>
        ) : null}
        {booking.charged ? (
          <div className={styles.line}>
            <dt>Charged to your card</dt>
            <dd>{booking.charged}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

export type ManageTooManyTriesProps = { retryAfterSeconds: number };

/** The page when the link has been tried too often: the same page for every visitor, with no booking on it. */
export function ManageTooManyTries({
  retryAfterSeconds,
}: ManageTooManyTriesProps) {
  const notice = cancelNotice('rate_limited', { retryAfterSeconds });
  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Your booking</h1>
      <Alert tone={notice.tone} title={notice.title} body={notice.body} />
    </div>
  );
}
