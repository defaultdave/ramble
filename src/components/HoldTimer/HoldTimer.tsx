import { Timer } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import { classNames } from '@/lib/classNames';
import {
  holdAnnouncement,
  holdTimerState,
  holdTimerText,
  type HoldTimerState,
} from '@/lib/holdTimer';
import styles from './HoldTimer.module.css';

export type HoldTimerProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'role' | 'className' | 'style'
> & {
  secondsRemaining: number;
};

const stateClass = {
  running: styles.running,
  warning: styles.warning,
  expired: styles.expired,
} satisfies Record<HoldTimerState, string | undefined>;

export function HoldTimer({ secondsRemaining, ...rest }: HoldTimerProps) {
  const state = holdTimerState(secondsRemaining);

  return (
    <>
      <div
        {...rest}
        role="timer"
        className={classNames(styles.timer, stateClass[state])}
      >
        <Timer className={styles.icon} aria-hidden="true" />
        {holdTimerText(secondsRemaining)}
      </div>
      <span role="status" className={styles.announcement}>
        {holdAnnouncement(secondsRemaining)}
      </span>
    </>
  );
}
