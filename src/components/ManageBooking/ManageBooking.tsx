'use client';

import { Info } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { Alert } from '@/components/Alert';
import { Button, ButtonLink } from '@/components/Button';
import type {
  CancelBookingInput,
  CancelBookingResult,
} from '@/lib/cancelBooking';
import {
  cancelNotice,
  retryAfterLine,
  type CancelNotice,
  type CancelPrompt,
  type ManageBooking as ManageBookingDetails,
  type ManageView,
} from '@/lib/manageBooking';
import { browsePath, contactPath, helpPath } from '@/lib/paths';
import styles from './ManageBooking.module.css';

export type CancelBookingAction = (
  input: CancelBookingInput,
) => Promise<CancelBookingResult>;

export type ManageBookingProps = {
  view: ManageView;
  /** The manage token the page was opened with: the caller's right to cancel. */
  token: string;
  /** `cancelBooking`. */
  cancel: CancelBookingAction;
};

export function ManageBooking({ view, token, cancel }: ManageBookingProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<CancelNotice | null>(null);
  const [pending, startTransition] = useTransition();
  const noticeRef = useRef<HTMLDivElement>(null);

  const settled = notice?.settled ?? false;

  const submit = (prompt: CancelPrompt) => {
    startTransition(async () => {
      const result = await cancel({
        manageToken: token,
        expectedRefundMinor: prompt.refundMinor,
      });
      setNotice(cancelNotice(result));
      setConfirming(false);
      // A changed refund is shown from the server's own quote, so the next confirm carries the new amount.
      if (result.status === 'terms_changed') router.refresh();
      noticeRef.current?.focus();
    });
  };

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <p className={styles.eyebrow}>
          From your confirmation email · no account needed
        </p>
        <h1 className={styles.heading}>Your booking</h1>
      </div>

      <div ref={noticeRef} tabIndex={-1} className={styles.notice}>
        {notice ? (
          <Alert tone={notice.tone} title={notice.title} body={notice.body} />
        ) : null}
      </div>

      <BookingCard booking={view.booking} />

      {view.kind === 'active' && !settled ? (
        <section className={styles.cancel} aria-labelledby="cancel-title">
          <h2 id="cancel-title" className={styles.subheading}>
            {view.prompt.heading}
          </h2>
          <p className={styles.body}>{view.prompt.body}</p>
          {confirming ? (
            <div
              className={styles.confirm}
              role="group"
              aria-labelledby="confirm-title"
            >
              <p id="confirm-title" className={styles.confirmTitle}>
                {view.prompt.confirmTitle}
              </p>
              <p className={styles.body}>{view.prompt.confirmBody}</p>
              <Button
                variant="primary"
                loading={pending}
                onClick={() => {
                  submit(view.prompt);
                }}
              >
                {view.prompt.buttonLabel}
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Keep my booking
              </Button>
            </div>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(true);
              }}
            >
              {view.prompt.buttonLabel}
            </Button>
          )}
          {view.prompt.arrivalLine ? (
            <p className={styles.fine}>
              Refunds go back to your card. {view.prompt.arrivalLine}
            </p>
          ) : null}
        </section>
      ) : null}

      {view.kind === 'cancelled' ? (
        <Alert
          tone="info"
          title="This booking is cancelled"
          body="Any refund that was due goes back to your original payment method."
          action={
            <ButtonLink href={browsePath} variant="secondary">
              Explore more experiences
            </ButtonLink>
          }
        />
      ) : null}

      {view.kind === 'closed' ? (
        <Alert
          tone="info"
          title="This booking can't be cancelled here"
          body="It isn't an active booking, or its session has started."
        />
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
          <dt>Total</dt>
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
  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Your booking</h1>
      <Alert
        tone="warning"
        title="Too many tries"
        body={retryAfterLine(retryAfterSeconds)}
      />
    </div>
  );
}
