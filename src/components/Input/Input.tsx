import { TriangleAlert } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import { useId } from 'react';
import styles from './Input.module.css';

export type InputProps = Omit<
  ComponentPropsWithoutRef<'input'>,
  'size' | 'className' | 'style'
> & {
  label: string;
  hint?: string;
  errorText?: string;
  optional?: boolean;
};

export function Input({
  label,
  hint,
  errorText,
  optional = false,
  id,
  'aria-describedby': describedBy,
  ...rest
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedByIds = [
    hint ? hintId : undefined,
    errorText ? errorId : undefined,
    describedBy,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
        {optional ? <span className={styles.optional}> (optional)</span> : null}
      </label>
      <input
        {...rest}
        id={inputId}
        className={styles.input}
        aria-invalid={errorText ? true : rest['aria-invalid']}
        aria-describedby={describedByIds || undefined}
      />
      {hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
      {errorText ? (
        <p className={styles.error} id={errorId}>
          <TriangleAlert className={styles.errorIcon} aria-hidden="true" />
          {errorText}
        </p>
      ) : null}
    </div>
  );
}
