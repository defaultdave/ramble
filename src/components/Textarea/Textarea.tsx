import type { ComponentPropsWithoutRef } from 'react';
import { useId } from 'react';
import { Field } from '@/components/Field';
import { fieldControl } from '@/lib/fieldIds';
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

/** TODO(U-073): first caller. */
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
      <div className={styles.control}>
        <textarea
          {...rest}
          id={control.fieldId}
          rows={rows}
          className={styles.textarea}
          aria-invalid={control.ariaInvalid}
          aria-describedby={control.describedBy}
        />
      </div>
    </Field>
  );
}
