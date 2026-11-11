import type { ComponentPropsWithoutRef } from 'react';
import { useId } from 'react';
import { Field } from '@/components/Field';
import { fieldControl } from '@/lib/fieldIds';
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
  const control = fieldControl({
    id,
    generatedId,
    hint,
    errorText,
    describedBy,
    ariaInvalid: rest['aria-invalid'],
  });

  return (
    <Field
      fieldId={control.fieldId}
      label={label}
      hint={hint}
      errorText={errorText}
      optional={optional}
    >
      <input
        {...rest}
        id={control.fieldId}
        className={styles.input}
        aria-invalid={control.ariaInvalid}
        aria-describedby={control.describedBy}
      />
    </Field>
  );
}
