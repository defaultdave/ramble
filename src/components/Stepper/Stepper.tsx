import { Minus, Plus } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import { useId } from 'react';
import { stepperLimits, steppedValue } from '@/lib/stepper';
import styles from './Stepper.module.css';

export type StepperProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'onChange' | 'children' | 'role' | 'className' | 'style'
> & {
  label: string;
  value: number;
  hint?: string;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
};

export function Stepper({
  label,
  value,
  hint,
  min,
  max,
  disabled = false,
  onChange,
  id,
  ...rest
}: StepperProps) {
  const generatedId = useId();
  const baseId = id ?? generatedId;
  const labelId = `${baseId}-label`;
  const hintId = `${baseId}-hint`;
  const { atMin, atMax } = stepperLimits(value, min, max);

  // aria-disabled instead of disabled at a limit, so focus stays on the button just pressed.
  const step = (delta: number, atLimit: boolean) => () => {
    if (!atLimit) onChange(steppedValue(value, delta, min, max));
  };

  const describedByIds = [hint ? hintId : undefined, rest['aria-describedby']]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      {...rest}
      id={baseId}
      role="group"
      className={styles.field}
      data-disabled={disabled || undefined}
      aria-disabled={disabled || undefined}
      aria-labelledby={labelId}
      aria-describedby={describedByIds || undefined}
    >
      <div className={styles.text}>
        <span className={styles.label} id={labelId}>
          {label}
        </span>
        {hint ? (
          <p className={styles.hint} id={hintId}>
            {hint}
          </p>
        ) : null}
      </div>
      <div className={styles.control}>
        <button
          type="button"
          className={styles.button}
          disabled={disabled}
          aria-disabled={atMin || undefined}
          aria-label={`Decrease ${label}`}
          onClick={step(-1, atMin)}
        >
          <Minus aria-hidden="true" />
        </button>
        <output className={styles.value}>{value}</output>
        <button
          type="button"
          className={styles.button}
          disabled={disabled}
          aria-disabled={atMax || undefined}
          aria-label={`Increase ${label}`}
          onClick={step(1, atMax)}
        >
          <Plus aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
