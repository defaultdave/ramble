import { TriangleAlert } from 'lucide-react';
import { useId } from 'react';
import { fieldControl, fieldIds } from '@/lib/fieldIds';
import styles from './CheckField.module.css';

export type CheckFieldProps = {
  name: string;
  label: string;
  /** What a ticked box posts; the browser's own "on" when left out. */
  value?: string;
  defaultChecked?: boolean;
  /** Why the last try refused this box, shown under it and tied to it. */
  problem?: string | undefined;
  /** Marks the box invalid when the reason is shown elsewhere, such as above a group of boxes. */
  invalid?: boolean;
  /** The id of text elsewhere that describes this box, such as a group's shared problem. */
  describedBy?: string | undefined;
};

/** A native checkbox that posts with a plain form and needs no script: for a server form that is read once on submit. */
export function CheckField({
  name,
  label,
  value,
  defaultChecked = false,
  problem,
  invalid = false,
  describedBy,
}: CheckFieldProps) {
  const control = fieldControl({
    generatedId: useId(),
    errorText: problem,
    describedBy,
    ariaInvalid: invalid ? true : undefined,
  });
  return (
    <div>
      <label className={styles.check}>
        <input
          type="checkbox"
          id={control.fieldId}
          name={name}
          value={value}
          defaultChecked={defaultChecked}
          aria-invalid={control.ariaInvalid}
          aria-describedby={control.describedBy}
        />
        <span>{label}</span>
      </label>
      {problem ? (
        <p
          role="alert"
          id={fieldIds(control.fieldId, { errorText: problem }).errorId}
          className={styles.problem}
        >
          <TriangleAlert className={styles.problemIcon} aria-hidden="true" />
          {problem}
        </p>
      ) : null}
    </div>
  );
}
