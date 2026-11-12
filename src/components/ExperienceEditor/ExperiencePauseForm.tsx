import { Button } from '@/components/Button';
import type { ExperienceStatus } from '@/lib/experienceEditor';
import styles from './ExperienceEditor.module.css';

export type ExperiencePauseFormProps = {
  experienceId: string;
  status: ExperienceStatus;
  pause: (formData: FormData) => void | Promise<void>;
  unpause: (formData: FormData) => void | Promise<void>;
};

/** Pause for a live experience, unpause for a paused one, and nothing for any other status, which neither action accepts. */
export function ExperiencePauseForm({
  experienceId,
  status,
  pause,
  unpause,
}: ExperiencePauseFormProps) {
  if (status !== 'live' && status !== 'paused') return null;
  const paused = status === 'paused';
  return (
    <section className={styles.section} aria-labelledby="experience-pause">
      <h2 className={styles.heading} id="experience-pause">
        Visibility
      </h2>
      <form action={paused ? unpause : pause} className={styles.section}>
        <input type="hidden" name="experienceId" value={experienceId} />
        <p className={styles.muted}>
          {paused
            ? 'Guests cannot see or book this experience. Unpausing makes it live again.'
            : 'Pausing hides this experience from guests and stops new bookings. Existing bookings stay.'}
        </p>
        <Button type="submit" variant="secondary">
          {paused ? 'Unpause experience' : 'Pause experience'}
        </Button>
      </form>
    </section>
  );
}
