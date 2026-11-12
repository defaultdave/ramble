import { Button } from '@/components/Button';
import type { HostSuspension as Suspension } from '@/lib/experiencePause';
import styles from './HostSetup.module.css';

type FormAction = (formData: FormData) => void | Promise<void>;

export type HostSuspensionProps = {
  hostId: string;
  suspension: Suspension;
  suspend: FormAction;
  unsuspend: FormAction;
};

const experiences = (count: number) =>
  `${String(count)} ${count === 1 ? 'experience' : 'experiences'}`;

/** Suspending pauses every live experience the host has; unsuspending unpauses only the ones a suspension paused. Each form shows only when it has something to do. */
export function HostSuspension({
  hostId,
  suspension,
  suspend,
  unsuspend,
}: HostSuspensionProps) {
  const { liveCount, suspendedCount } = suspension;
  return (
    <section className={styles.section} aria-labelledby="host-suspension">
      <h2 className={styles.heading} id="host-suspension">
        Suspension
      </h2>
      {liveCount === 0 && suspendedCount === 0 ? (
        <p className={styles.muted}>
          This host has no live experiences and none paused by a suspension.
        </p>
      ) : null}
      {liveCount > 0 ? (
        <form action={suspend} className={styles.section}>
          <input type="hidden" name="hostId" value={hostId} />
          <p className={styles.muted}>
            {`Suspending pauses ${experiences(liveCount)} that ${liveCount === 1 ? 'is' : 'are'} live. Guests stop seeing and booking them. Existing bookings stay.`}
          </p>
          <Button type="submit" variant="secondary">
            Suspend host
          </Button>
        </form>
      ) : null}
      {suspendedCount > 0 ? (
        <form action={unsuspend} className={styles.section}>
          <input type="hidden" name="hostId" value={hostId} />
          <p className={styles.muted}>
            {`Unsuspending makes the ${experiences(suspendedCount)} paused by a suspension live again. Anything paused by hand stays paused.`}
          </p>
          <Button type="submit" variant="secondary">
            Unsuspend host
          </Button>
        </form>
      ) : null}
    </section>
  );
}
