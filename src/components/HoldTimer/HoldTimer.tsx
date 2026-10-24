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
  now: Date;
  expiresAt: Date;
};

const stateClass = {
  running: styles.running,
  warning: styles.warning,
  expired: styles.expired,
} satisfies Record<HoldTimerState, string | undefined>;

// TODO(U-047b): first caller, the checkout page, which passes it to the checkout Header.
export function HoldTimer({ now, expiresAt, ...rest }: HoldTimerProps) {
  const state = holdTimerState(now, expiresAt);

  return (
    <>
      <div
        {...rest}
        role="timer"
        className={classNames(styles.timer, stateClass[state])}
      >
        <Timer className={styles.icon} aria-hidden="true" />
        {holdTimerText(now, expiresAt)}
      </div>
      <span role="status" className={styles.announcement}>
        {holdAnnouncement(now, expiresAt)}
      </span>
    </>
  );
}
