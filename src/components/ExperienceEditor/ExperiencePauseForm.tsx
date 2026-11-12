import { Button } from '@/components/Button';
import type { ExperienceStatus } from '@/lib/experienceEditor';
import {
  pauseActionFor,
  pauseActionLabel,
  pauseExplainerText,
} from '@/lib/experiencePause';
import styles from './ExperienceEditor.module.css';

export type ExperiencePauseFormProps = {
  experienceId: string;
  status: ExperienceStatus;
  pause: (formData: FormData) => void | Promise<void>;
  unpause: (formData: FormData) => void | Promise<void>;
};

/** The one action the status allows, pause or unpause, and nothing for a status that allows neither. */
export function ExperiencePauseForm({
  experienceId,
  status,
  pause,
  unpause,
}: ExperiencePauseFormProps) {
  const kind = pauseActionFor(status);
  if (kind === null) return null;
  return (
    <section className={styles.section} aria-labelledby="experience-pause">
      <h2 className={styles.heading} id="experience-pause">
        Visibility
      </h2>
      <form
        action={kind === 'pause' ? pause : unpause}
        className={styles.section}
      >
        <input type="hidden" name="experienceId" value={experienceId} />
        <p className={styles.muted}>{pauseExplainerText(kind)}</p>
        <Button type="submit" variant="secondary">
          {pauseActionLabel(kind)}
        </Button>
      </form>
    </section>
  );
}
