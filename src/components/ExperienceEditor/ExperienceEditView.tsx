import { StatusBadge } from '@/components/StatusBadge';
import {
  experienceStatusLabels,
  experienceStatusTones,
  type ExperienceChoices,
  type ExperienceEditView as EditView,
  type ExperienceFormField,
} from '@/lib/experienceEditor';
import { ExperienceForm } from './ExperienceForm';
import styles from './ExperienceEditor.module.css';

export type ExperienceEditViewProps = {
  view: EditView;
  choices: ExperienceChoices;
  problems?: readonly ExperienceFormField[];
  save: (formData: FormData) => void | Promise<void>;
};

/** A saved experience: whose it is and where it stands, then the form that saves it. Status is shown, never edited here. */
export function ExperienceEditView({
  view,
  choices,
  problems = [],
  save,
}: ExperienceEditViewProps) {
  return (
    <div className={styles.stack}>
      <div className={styles.summary}>
        <StatusBadge
          tone={experienceStatusTones[view.status]}
          label={experienceStatusLabels[view.status]}
        />
        <p className={styles.muted}>Host: {view.hostName}</p>
      </div>
      <ExperienceForm
        action={save}
        values={view.content}
        choices={choices}
        experienceId={view.id}
        guideOnly={view.status === 'guide_only'}
        problems={problems}
      />
    </div>
  );
}
