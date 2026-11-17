import Link from 'next/link';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { CheckField } from '@/components/CheckField';
import { AccountControl } from '@/components/Header/AccountControl';
import { HiddenFields } from '@/components/HiddenFields';
import { PageHeading } from '@/components/PageHeading';
import { hostCancelCopy } from '@/lib/copy/hostSessions';
import type { HostCancelView } from '@/lib/hostCancelSession';
import { hostSessionsPath } from '@/lib/hostSessions';
import styles from './HostCancelSession.module.css';

export const hostCancelTitle = hostCancelCopy.title;

type FormAction = (formData: FormData) => void | Promise<void>;

/**
 * A host's cancellation of one session: the session, who cancelling affects and what each is
 * refunded, then the form that confirms it. The form carries the impact the host read back to the
 * server, which refuses to cancel if it changed. A session that cannot be cancelled says why and
 * shows no form.
 */
export function HostCancelSession({
  view,
  action,
}: {
  view: HostCancelView;
  action: FormAction;
}) {
  const { impact } = view;
  return (
    <>
      <PageHeading title={hostCancelTitle}>
        <p>{view.title}</p>
        <AccountControl signedIn />
      </PageHeading>
      <div className={styles.sections}>
        <p>
          <Link href={hostSessionsPath}>{hostCancelCopy.backLabel}</Link>
        </p>
        <dl className={styles.facts}>
          <dt>{hostCancelCopy.factLabels.experience}</dt>
          <dd>{view.experienceName}</dd>
          <dt>{hostCancelCopy.factLabels.when}</dt>
          <dd>{view.whenLabel}</dd>
          <dt>{hostCancelCopy.factLabels.seats}</dt>
          <dd>{view.seatsLabel}</dd>
          <dt>{hostCancelCopy.factLabels.status}</dt>
          <dd>{view.statusLabel}</dd>
        </dl>

        <section aria-labelledby="impact-heading">
          <h2 id="impact-heading" className={styles.heading}>
            {hostCancelCopy.impactHeading}
          </h2>
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
        </section>

        <section aria-labelledby="cancel-heading">
          <h2 id="cancel-heading" className={styles.heading}>
            {hostCancelCopy.formHeading}
          </h2>
          {view.stateText === null ? (
            <form action={action} className={styles.form}>
              <p>{hostCancelCopy.explainer}</p>
              <HiddenFields
                fields={[
                  ['sessionId', view.id],
                  ['fingerprint', impact.fingerprint],
                ]}
              />
              <CheckField name="confirm" label={hostCancelCopy.confirmLabel} />
              <Button type="submit">{hostCancelCopy.submitLabel}</Button>
            </form>
          ) : (
            <p>{view.stateText}</p>
          )}
        </section>
      </div>
    </>
  );
}
