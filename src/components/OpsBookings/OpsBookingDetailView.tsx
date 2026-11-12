import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/Button';
import { StatusBadge } from '@/components/StatusBadge';
import {
  cancelBasisLines,
  opsBookingsPath,
  orderStatusLabels,
  orderStatusTones,
  type OpsBookingDetail,
} from '@/lib/opsBookings';
import styles from './OpsBookings.module.css';

type FormAction = (formData: FormData) => void | Promise<void>;

export type OpsBookingActions = {
  cancel: FormAction;
  refund: FormAction;
  retryRefund: FormAction;
  resend: FormAction;
  voidLinks: FormAction;
};

function ActionForm({
  action,
  orderId,
  label,
  help,
  children,
}: {
  action: FormAction;
  orderId: string;
  label: string;
  help: string;
  children?: ReactNode;
}) {
  return (
    <li className={styles.row}>
      <form action={action} className={styles.actionForm}>
        <input type="hidden" name="orderId" value={orderId} />
        {children}
        <p className={styles.muted}>{help}</p>
        <Button type="submit" variant="secondary">
          {label}
        </Button>
      </form>
    </li>
  );
}

/** One booking: who and what, the actions ops may take on it (each a plain form), its refunds, and its history. */
export function OpsBookingDetailView({
  detail,
  actions,
}: {
  detail: OpsBookingDetail;
  actions: OpsBookingActions;
}) {
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

      <section className={styles.section} aria-labelledby="actions-heading">
        <h2 id="actions-heading" className={styles.heading}>
          Actions
        </h2>
        <ul className={styles.list}>
          {detail.cancel === null ? null : (
            <ActionForm
              action={actions.cancel}
              orderId={row.id}
              label="Cancel booking"
              help={cancelBasisLines[detail.cancel.basis]}
            >
              <input
                type="hidden"
                name="expectedRefundMinor"
                value={detail.cancel.refundMinor}
              />
            </ActionForm>
          )}
          {detail.canRefund ? (
            <ActionForm
              action={actions.refund}
              orderId={row.id}
              label="Refund the rest"
              help="Sends back everything this booking still holds, to the card it was paid with."
            />
          ) : null}
          {detail.canRetryRefund ? (
            <ActionForm
              action={actions.retryRefund}
              orderId={row.id}
              label="Retry refund"
              help="The last refund failed. This asks the payment provider again."
            />
          ) : null}
          {detail.canResend ? (
            <ActionForm
              action={actions.resend}
              orderId={row.id}
              label="Resend confirmation"
              help="Emails the confirmation and calendar file to the address on the booking, with a working link."
            />
          ) : null}
          <ActionForm
            action={actions.voidLinks}
            orderId={row.id}
            label="Void earlier links"
            help="Stops every link already emailed from opening this booking. Resend the confirmation for a new one."
          />
        </ul>
      </section>

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
