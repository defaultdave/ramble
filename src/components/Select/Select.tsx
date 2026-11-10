import { ChevronDown } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import { useId } from 'react';
import { Field } from '@/components/Field';
import { classNames } from '@/lib/classNames';
import { fieldIds } from '@/lib/fieldIds';
import styles from './Select.module.css';

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectVariant = 'default' | 'hero';

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
  /** The hero search's look: a quieter chevron and a slimmer end padding. */
  variant?: SelectVariant;
};

export function Select({
  label,
  options,
  placeholder,
  hint,
  errorText,
  optional = false,
  variant = 'default',
  id,
  'aria-describedby': describedBy,
  ...rest
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const ids = fieldIds(selectId, { hint, errorText, describedBy });

  return (
    <Field
      fieldId={selectId}
      label={label}
      hint={hint}
      errorText={errorText}
      optional={optional}
    >
      <div
        className={classNames(
          styles.control,
          variant === 'hero' && styles.hero,
        )}
      >
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
    </Field>
  );
}
