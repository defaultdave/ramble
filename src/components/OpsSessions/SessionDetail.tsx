import Link from 'next/link';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { CheckField } from '@/components/CheckField';
import { HiddenFields } from '@/components/HiddenFields';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { StatusBadge } from '@/components/StatusBadge';
import { experiencePath } from '@/lib/experienceEditor';
import {
  opsCancelReasonOptions,
  opsSessionsPath,
  type ImpactView,
  type OpsSessionView,
  type PauseView,
} from '@/lib/opsSessions';
import styles from './OpsSessions.module.css';

type FormAction = (formData: FormData) => void | Promise<void>;

export type SessionDetailProps = {
  session: OpsSessionView;
  impact: ImpactView;
  /** Null when the experience has nothing to pause. */
  pause: PauseView | null;
  actions: { cancel: FormAction; allocation: FormAction; pause: FormAction };
};

function Impact({ impact }: { impact: ImpactView }) {
  return (
    <>
      <p>{impact.summary}</p>
      {impact.bookings.length > 0 ? (
        <ul className={styles.list}>
          {impact.bookings.map((booking) => (
            <li key={booking.reference} className={styles.row}>
              {booking.reference}
              <span className={styles.muted}>{booking.amountLabel}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {impact.moreLabel ? (
        <p className={styles.muted}>{impact.moreLabel}</p>
      ) : null}
      {impact.blockedText ? (
        <Alert tone="danger" title={impact.blockedText} />
      ) : null}
    </>
  );
}

const confirmLabel = 'I have read who this affects';

/** One session: its facts, the guest impact of cancelling it, and the cancel form. The impact comes before the form, and the form carries it back. */
export function SessionDetail({
  session,
  impact,
  pause,
  actions,
}: SessionDetailProps) {
  return (
    <div className={styles.stack}>
      <p>
        <Link href={opsSessionsPath}>Back to the sessions</Link>
      </p>
      <dl className={styles.facts}>
        <dt>When</dt>
        <dd>{session.whenLabel}</dd>
        <dt>Experience</dt>
        <dd>
          <Link href={experiencePath(session.experienceId)}>
            {session.experienceName}
          </Link>
        </dd>
        <dt>Host</dt>
        <dd>{session.hostName}</dd>
        <dt>Seats</dt>
        <dd>{session.seatsLabel}</dd>
        <dt>Status</dt>
        <dd>
          <StatusBadge tone={session.statusTone} label={session.statusLabel} />
        </dd>
      </dl>

      <section className={styles.section} aria-labelledby="impact-heading">
        <h2 id="impact-heading" className={styles.heading}>
          Who this affects
        </h2>
        <Impact impact={impact} />
      </section>

      <section className={styles.section} aria-labelledby="cancel-heading">
        <h2 id="cancel-heading" className={styles.heading}>
          Cancel this session
        </h2>
        <form action={actions.cancel} className={styles.form}>
          <HiddenFields
            fields={[
              ['sessionId', session.id],
              ['fingerprint', impact.fingerprint],
            ]}
          />
          <Select
            name="reason"
            label="Reason"
            options={opsCancelReasonOptions}
            defaultValue="ramble"
          />
          <CheckField name="confirm" label={confirmLabel} />
          <Button type="submit" disabled={!session.canCancel}>
            Cancel session and refund its bookings
          </Button>
        </form>
      </section>

      <section className={styles.section} aria-labelledby="capacity-heading">
        <h2 id="capacity-heading" className={styles.heading}>
          Change capacity
        </h2>
        <form action={actions.allocation} className={styles.form}>
          <HiddenFields
            fields={[
              ['sessionId', session.id],
              ['expectedVersion', String(session.version)],
            ]}
          />
          <Input
            name="allocation"
            label="Capacity"
            type="number"
            inputMode="numeric"
            min={session.minCapacity}
            defaultValue={session.capacity}
            hint={session.capacityHint}
            required
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={!session.canEditCapacity}
          >
            Save capacity
          </Button>
        </form>
      </section>

      {pause ? (
        <section className={styles.section} aria-labelledby="pause-heading">
          <h2 id="pause-heading" className={styles.heading}>
            Pause this experience
          </h2>
          <p>{pause.explainer}</p>
          <p>{pause.sessionsLabel}</p>
          <Impact impact={pause.impact} />
          <form action={actions.pause} className={styles.form}>
            <HiddenFields
              fields={[
                ['sessionId', session.id],
                ['fingerprint', pause.impact.fingerprint],
              ]}
            />
            <CheckField name="confirm" label={confirmLabel} />
            <Button
              type="submit"
              variant="secondary"
              disabled={!pause.canPause}
            >
              {pause.buttonLabel}
            </Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
