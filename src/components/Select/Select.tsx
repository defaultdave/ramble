import { ChevronDown, TriangleAlert } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import { useId } from 'react';
import { fieldIds } from '@/lib/fieldIds';
import styles from './Select.module.css';

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectProps = Omit<
  ComponentPropsWithoutRef<'select'>,
  'size' | 'className' | 'style' | 'children'
> & {
  label: string;
  options: readonly SelectOption[];
  /** The empty first choice, for a field with no answer yet. */
  placeholder?: string;
  hint?: string;
  errorText?: string;
  optional?: boolean;
};

export function Select({
  label,
  options,
  placeholder,
  hint,
  errorText,
  optional = false,
  id,
  'aria-describedby': describedBy,
  ...rest
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const ids = fieldIds(selectId, { hint, errorText, describedBy });

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={selectId}>
        {label}
        {optional ? <span className={styles.optional}> (optional)</span> : null}
      </label>
      <div className={styles.control}>
        <select
          {...rest}
          id={selectId}
          className={styles.select}
          aria-invalid={errorText ? true : rest['aria-invalid']}
          aria-describedby={ids.describedBy}
        >
          {placeholder === undefined ? null : (
            <option value="">{placeholder}</option>
          )}
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className={styles.chevron} aria-hidden="true" />
      </div>
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
