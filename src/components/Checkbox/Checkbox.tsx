import { Check } from 'lucide-react';
import type { ChangeEventHandler, ComponentPropsWithoutRef } from 'react';
import { useId } from 'react';
import styles from './Checkbox.module.css';

export type CheckboxProps = Omit<
  ComponentPropsWithoutRef<'input'>,
  'type' | 'checked' | 'onChange' | 'size'
> & {
  checked: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
  label: string;
  description?: string;
};

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  id,
  'aria-describedby': describedBy,
  ...rest
}: CheckboxProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;
  const describedByIds = [description ? descriptionId : undefined, describedBy]
    .filter(Boolean)
    .join(' ');

  const invalid =
    rest['aria-invalid'] === true || rest['aria-invalid'] === 'true';

  return (
    <div
      className={styles.field}
      data-disabled={rest.disabled || undefined}
      data-invalid={invalid || undefined}
    >
      <span className={styles.box}>
        <input
          {...rest}
          id={inputId}
          type="checkbox"
          className={styles.input}
          checked={checked}
          onChange={onChange}
          aria-describedby={describedByIds || undefined}
        />
        <Check className={styles.mark} aria-hidden="true" />
      </span>
      <div className={styles.text}>
        <label className={styles.label} htmlFor={inputId}>
          {label}
        </label>
        {description ? (
          <p className={styles.description} id={descriptionId}>
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
