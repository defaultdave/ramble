import type { ComponentPropsWithoutRef } from 'react';
import { useId } from 'react';
import { Field } from '@/components/Field';
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
  const textareaId = id ?? generatedId;
  const ids = fieldIds(textareaId, { hint, errorText, describedBy });

  return (
    <Field
      fieldId={textareaId}
      label={label}
      hint={hint}
      errorText={errorText}
      optional={optional}
    >
      <div className={styles.control}>
        <textarea
          {...rest}
          id={textareaId}
          rows={rows}
          className={styles.textarea}
          aria-invalid={errorText ? true : rest['aria-invalid']}
          aria-describedby={ids.describedBy}
        />
      </div>
    </Field>
  );
}
