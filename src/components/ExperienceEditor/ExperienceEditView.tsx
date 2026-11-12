import { StatusBadge } from '@/components/StatusBadge';
import {
  experienceStatusLabels,
  linksOut,
  experienceStatusTones,
  type ExperienceChoices,
  type ExperienceEditView as EditView,
  type ExperienceFormField,
} from '@/lib/experienceEditor';
import type { PhotoFormField } from '@/lib/photoForm';
import type { PhotoRefusalCode } from '@/lib/photos';
import { ExperienceForm } from './ExperienceForm';
import { ExperiencePhotos } from './ExperiencePhotos';
import styles from './ExperienceEditor.module.css';

export type ExperienceEditViewProps = {
  view: EditView;
  choices: ExperienceChoices;
  problems?: readonly ExperienceFormField[];
  /** The fields the last photo upload needed another look at, and why a refused file was refused. */
  photoProblems?: readonly PhotoFormField[];
  photoRefusal?: PhotoRefusalCode | null;
  save: (formData: FormData) => void | Promise<void>;
  addPhoto: (formData: FormData) => void | Promise<void>;
};

/** A saved experience: whose it is and where it stands, then the form that saves it and its photos. Status is shown, never edited here. */
export function ExperienceEditView({
  view,
  choices,
  problems = [],
  photoProblems = [],
  photoRefusal = null,
  save,
  addPhoto,
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
        guideOnly={linksOut(view.status)}
        problems={problems}
      />
      <ExperiencePhotos
        experienceId={view.id}
        photos={view.photos}
        problems={photoProblems}
        refusal={photoRefusal}
        add={addPhoto}
      />
    </div>
  );
}
