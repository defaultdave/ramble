import { Button } from '@/components/Button';
import {
  hostSuspendedText,
  suspensionActionLabel,
  suspensionLiveText,
  suspensionUndoText,
  type HostSuspension as Suspension,
} from '@/lib/experiencePause';
import styles from './HostSetup.module.css';

type FormAction = (formData: FormData) => void | Promise<void>;

export type HostSuspensionProps = {
  hostId: string;
  suspension: Suspension;
  suspend: FormAction;
  unsuspend: FormAction;
};

/** A host that is not suspended offers Suspend; a suspended one says so and offers Unsuspend. Each says what it will do. */
export function HostSuspension({
  hostId,
  suspension,
  suspend,
  unsuspend,
}: HostSuspensionProps) {
  const { suspended, liveCount, suspendedCount } = suspension;
  return (
    <section className={styles.section} aria-labelledby="host-suspension">
      <h2 className={styles.heading} id="host-suspension">
        Suspension
      </h2>
      {suspended ? (
        <form action={unsuspend} className={styles.section}>
          <input type="hidden" name="hostId" value={hostId} />
          <p className={styles.muted}>{hostSuspendedText}</p>
          <p className={styles.muted}>{suspensionUndoText(suspendedCount)}</p>
          <Button type="submit" variant="secondary">
            {suspensionActionLabel('unpause')}
          </Button>
        </form>
      ) : (
        <form action={suspend} className={styles.section}>
          <input type="hidden" name="hostId" value={hostId} />
          <p className={styles.muted}>{suspensionLiveText(liveCount)}</p>
          <Button type="submit" variant="secondary">
            {suspensionActionLabel('pause')}
          </Button>
        </form>
      )}
    </section>
  );
}
