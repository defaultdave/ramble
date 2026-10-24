import type { ComponentPropsWithoutRef } from 'react';
import { classNames } from '@/lib/classNames';
import { spacesLabel } from '@/lib/spaces';
import { timeSlotState, type TimeSlotState } from '@/lib/timeSlot';
import styles from './TimeSlot.module.css';

export type TimeSlotProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  | 'children'
  | 'onClick'
  | 'disabled'
  | 'aria-pressed'
  | 'aria-disabled'
  | 'className'
  | 'style'
> & {
  time: string;
  spacesLeft: number;
  selected: boolean;
  onToggle: () => void;
};

const stateClass = {
  open: styles.open,
  'few-left': styles.fewLeft,
  'sold-out': styles.soldOut,
  selected: styles.selected,
} satisfies Record<TimeSlotState, string | undefined>;

// TODO(U-041): first caller, the booking sheet and panel.
export function TimeSlot({
  time,
  spacesLeft,
  selected,
  onToggle,
  type = 'button',
  ...rest
}: TimeSlotProps) {
  const state = timeSlotState(spacesLeft, selected);
  const soldOut = state === 'sold-out';

  // aria-disabled instead of disabled, so a sold-out slot stays in the tab order and is read out.
  return (
    <button
      {...rest}
      type={type}
      className={classNames(styles.slot, stateClass[state])}
      aria-pressed={state === 'selected'}
      aria-disabled={soldOut || undefined}
      onClick={soldOut ? undefined : onToggle}
    >
      <span className={styles.time}>{time}</span>{' '}
      <span className={styles.note}>{spacesLabel(spacesLeft)}</span>
    </button>
  );
}
