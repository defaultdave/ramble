import type { ComponentPropsWithoutRef } from 'react';
import { useId } from 'react';
import { Field } from '@/components/Field';
import { fieldIds } from '@/lib/fieldIds';
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
  const ids = fieldIds(inputId, { hint, errorText, describedBy });

  return (
    <Field
      fieldId={inputId}
      label={label}
      hint={hint}
      errorText={errorText}
      optional={optional}
    >
      <input
        {...rest}
        id={inputId}
        className={styles.input}
        aria-invalid={errorText ? true : rest['aria-invalid']}
        aria-describedby={ids.describedBy}
      />
    </Field>
  );
}
