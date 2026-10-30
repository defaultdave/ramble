'use client';

import { HoldTimer } from '@/components/HoldTimer';
import { useHoldCountdown } from './useHoldCountdown';

export type CheckoutHoldTimerProps = {
  expiresAt: string;
  serverNow: string;
  /** Called once when the hold runs out. */
  onEnd: () => void;
};

/**
 * The hold timer with its own clock. The tick is state here, so each second re-renders only the
 * timer and not the checkout page around it.
 */
export function CheckoutHoldTimer({
  expiresAt,
  serverNow,
  onEnd,
}: CheckoutHoldTimerProps) {
  const { now, expires } = useHoldCountdown(expiresAt, serverNow, onEnd);
  return <HoldTimer now={now} expiresAt={expires} />;
}
