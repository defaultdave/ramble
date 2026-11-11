import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { fieldIds } from '@/lib/fieldIds';
import styles from './Field.module.css';

export type FieldProps = {
  /** The id of the control inside, which the label points at and the hint and error ids derive from. */
  fieldId: string;
  label: string;
  hint?: string | undefined;
  errorText?: string | undefined;
  optional?: boolean;
  /** The control. It sets its own `aria-describedby` from `fieldIds(fieldId, ...)`. */
  children: ReactNode;
};

/** The label, optional marker, hint, and error around one form control, shared by every field. */
export function Field({
  fieldId,
  label,
  hint,
  errorText,
  optional = false,
  children,
}: FieldProps) {
  const ids = fieldIds(fieldId, { hint, errorText });
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={fieldId}>
        {label}
        {optional ? <span className={styles.optional}> (optional)</span> : null}
      </label>
      {children}
      {hint ? (
        <p className={styles.hint} id={ids.hintId}>
          {hint}
        </p>
      ) : null}
      {errorText ? (
        <p className={styles.error} id={ids.errorId}>
          <TriangleAlert className={styles.errorIcon} aria-hidden="true" />
          {errorText}
        </p>
      ) : null}
    </div>
  );
}
