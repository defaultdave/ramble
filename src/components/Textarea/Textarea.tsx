import { TriangleAlert } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import { useId } from 'react';
import { fieldIds } from '@/lib/fieldIds';
import styles from './Textarea.module.css';

export type TextareaProps = Omit<
  ComponentPropsWithoutRef<'textarea'>,
  'className' | 'style'
> & {
  label: string;
  hint?: string;
  errorText?: string;
  optional?: boolean;
};

export function Textarea({
  label,
  hint,
  errorText,
  optional = false,
  rows = 4,
  id,
  'aria-describedby': describedBy,
  ...rest
}: TextareaProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const ids = fieldIds(textareaId, { hint, errorText, describedBy });

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={textareaId}>
        {label}
        {optional ? <span className={styles.optional}> (optional)</span> : null}
      </label>
      <textarea
        {...rest}
        id={textareaId}
        rows={rows}
        className={styles.textarea}
        aria-invalid={errorText ? true : rest['aria-invalid']}
        aria-describedby={ids.describedBy}
      />
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
