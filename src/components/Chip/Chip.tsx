import type { ComponentPropsWithRef, ReactNode } from 'react';
import styles from './Chip.module.css';

export type ChipProps = Omit<
  ComponentPropsWithRef<'button'>,
  'children' | 'onClick' | 'aria-pressed' | 'className' | 'style'
> & {
  selected: boolean;
  label: string;
  count?: number;
  iconStart?: ReactNode;
  onToggle: () => void;
};

export function Chip({
  selected,
  label,
  count,
  iconStart,
  onToggle,
  type = 'button',
  ...rest
}: ChipProps) {
  return (
    <button
      {...rest}
      type={type}
      className={styles.chip}
      aria-pressed={selected}
      onClick={onToggle}
    >
      {iconStart ? (
        <span className={styles.icon} aria-hidden="true">
          {iconStart}
        </span>
      ) : null}
      {label}
      {count === undefined ? null : (
        <span className={styles.count}>{count}</span>
      )}
    </button>
  );
}
