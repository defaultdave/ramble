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
import { movePickerPath, type MovePrompt } from '@/lib/moveBooking';
import { browsePath, contactPath, helpPath } from '@/lib/paths';
import { managePath } from '@/lib/routes';
import styles from './ManageBooking.module.css';

/** `cancelBookingForm`: posts the form's token and shown refund, then sends the guest back to the page. */
export type CancelBookingFormAction = (formData: FormData) => Promise<void>;

/** `moveBookingForm`: posts the form's token and the date chosen, then sends the guest back to the page. */
export type MoveBookingFormAction = (formData: FormData) => Promise<void>;

export type ManageBookingProps = {
  view: ManageView;
  /** The manage token the page was opened with: the caller's right to cancel. */
  token: string;
  /** The one notice the page shows, from `managePageState`. */
  notice: CancelNotice | null;
  /** The second step: the cancel form, with the refund said again. */
  confirming: boolean;
  cancelAction: CancelBookingFormAction;
  /** The move's second step: the picker of other dates. */
  moving: boolean;
  moveAction: MoveBookingFormAction;
};

/**
 * The manage page. It is a server component and works with scripting off: the first step is the
 * page with the refund shown, a link to the second step is `?confirm=1`, and the second step is a
 * form that posts the cancel action. Moving to another date works the same way, with `?move=1`.
 */
export function ManageBooking({
  view,
  token,
  notice,
  confirming,
  cancelAction,
  moving,
  moveAction,
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

      {view.kind === 'active' && view.move ? (
        <MoveSection
          prompt={view.move}
          token={token}
          moving={moving}
          moveAction={moveAction}
        />
      ) : null}

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

function MoveSection({
  prompt,
  token,
  moving,
  moveAction,
}: {
  prompt: MovePrompt;
  token: string;
  moving: boolean;
  moveAction: MoveBookingFormAction;
}) {
  const { picker } = prompt;
  return (
    <section className={styles.cancel} aria-labelledby="move-title">
      <h2 id="move-title" className={styles.subheading}>
        {prompt.heading}
      </h2>
      <p className={styles.body}>{prompt.body}</p>
      {moving && picker ? (
        picker.choices.length > 0 ? (
          <form action={moveAction} className={styles.confirm}>
            <fieldset className={styles.choices}>
              <legend className={styles.confirmTitle}>{picker.legend}</legend>
              {picker.choices.map((choice, index) => (
                <label key={choice.sessionId} className={styles.choice}>
                  <input
                    type="radio"
                    name="targetSessionId"
                    value={choice.sessionId}
                    required
                    defaultChecked={index === 0}
                  />
                  <span>{choice.label}</span>
                  <span className={styles.fine}>{choice.spacesLabel}</span>
                </label>
              ))}
            </fieldset>
            <p className={styles.fine}>{picker.note}</p>
            <input type="hidden" name="manageToken" value={token} />
            <Button type="submit" variant="primary">
              {picker.submitLabel}
            </Button>
            <ButtonLink href={managePath(token)} variant="secondary">
              {picker.keepLabel}
            </ButtonLink>
          </form>
        ) : (
          <>
            <p className={styles.body}>{picker.emptyLine}</p>
            <ButtonLink href={managePath(token)} variant="secondary">
              {picker.keepLabel}
            </ButtonLink>
          </>
        )
      ) : (
        <ButtonLink href={movePickerPath(token)} variant="secondary">
          {prompt.linkLabel}
        </ButtonLink>
      )}
    </section>
  );
}

function BookingCard({ booking }: { booking: ManageBookingDetails }) {
  return (
    <section className={styles.card} aria-labelledby="booking-title">
      <h2 id="booking-title" className={styles.title}>
        {booking.experienceName}
      </h2>
      <p className={styles.meta}>{booking.metaLine}</p>
      <p className={styles.meta}>{booking.referenceLine}</p>
      {booking.meetingLine ? (
        <p className={styles.where}>{booking.meetingLine}</p>
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
            <dt>{booking.giftAppliedLabel}</dt>
            <dd>{booking.giftApplied}</dd>
          </div>
        ) : null}
        {booking.charged ? (
          <div className={styles.line}>
            <dt>{booking.chargedLabel}</dt>
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
