import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { StatusBadge } from '@/components/StatusBadge';
import {
  acceptanceLabels,
  acceptanceRecordLabel,
  acceptanceTones,
  type HostDetail,
  type HostFormField,
} from '@/lib/hostSetup';
import { HostForm } from './HostForm';
import styles from './HostSetup.module.css';

type FormAction = (formData: FormData) => void | Promise<void>;

export type HostDetailViewProps = {
  detail: HostDetail;
  problems: readonly HostFormField[];
  actions: {
    save: FormAction;
    accept: FormAction;
    resendInvite: FormAction;
  };
};

/** One host: who owns it and the link to send them again, where it stands on the agreement, and the record to edit. */
export function HostDetailView({
  detail,
  problems,
  actions,
}: HostDetailViewProps) {
  const { host, owners, agreement, acceptances } = detail;
  const state = detail.acceptance;
  return (
    <div className={styles.stack}>
      <section className={styles.section} aria-labelledby="host-owners">
        <h2 className={styles.heading} id="host-owners">
          Owners
        </h2>
        {owners.length === 0 ? (
          <p className={styles.muted}>This host has no owner yet.</p>
        ) : (
          <ul className={styles.list}>
            {owners.map((owner) => (
              <li key={owner.userId} className={styles.row}>
                <span>{owner.email}</span>
                <form action={actions.resendInvite}>
                  <input type="hidden" name="hostId" value={host.id} />
                  <input
                    type="hidden"
                    name="ownerUserId"
                    value={owner.userId}
                  />
                  <Button type="submit" variant="secondary">
                    Send a sign-in link
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="host-agreement">
        <h2 className={styles.heading} id="host-agreement">
          Host agreement
        </h2>
        <StatusBadge
          tone={acceptanceTones[state]}
          label={acceptanceLabels[state]}
        />
        {acceptances.length > 0 ? (
          <ul className={styles.list} aria-label="Accepted versions">
            {acceptances.map((record) => (
              <li key={record.legalDocumentId} className={styles.muted}>
                {acceptanceRecordLabel(record, host.timeZone)}
              </li>
            ))}
          </ul>
        ) : null}
        {agreement === null ? (
          <Alert
            tone="info"
            title="No host agreement is published."
            body="Publish one in the legal documents before recording an acceptance."
          />
        ) : null}
        {agreement !== null && state !== 'accepted' ? (
          <form action={actions.accept} className={styles.section}>
            <input type="hidden" name="hostId" value={host.id} />
            <input type="hidden" name="legalDocumentId" value={agreement.id} />
            <p className={styles.muted}>
              {`Record that this host accepted the current ${agreement.title}, version ${String(agreement.version)}, which includes the content-rights terms.`}
            </p>
            <Button type="submit" variant="secondary">
              {`Record acceptance of version ${String(agreement.version)}`}
            </Button>
          </form>
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="host-record">
        <h2 className={styles.heading} id="host-record">
          Host record
        </h2>
        <HostForm action={actions.save} values={host} problems={problems} />
      </section>
    </div>
  );
}
