import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  pollDelayMs,
  pollStep,
  settledMessage,
  type OrderStatusInput,
  type OrderStatusResult,
} from '@/lib/orderStatus';

/** The server action that answers, handed in by the page so a story or test can answer in its place. */
export type CheckOrderStatus = (
  input: OrderStatusInput,
) => Promise<OrderStatusResult>;

export type OrderStatusPolling = {
  /** True once the polls ran out without the order settling. */
  gaveUp: boolean;
  /** What the status region says once the order has settled and the page is about to render again; null before. */
  settledMessage: string | null;
  /** Starts the polls again from the short delays. */
  checkAgain: () => void;
};

/**
 * Asks `getOrderStatus` on a growing delay until the order settles or the polls run out. A
 * settled order, in any state, has the page render again: the page checks the token itself and
 * decides what to show, so this hook holds no verdict of its own.
 */
export function useOrderStatus(
  input: OrderStatusInput,
  check: CheckOrderStatus,
): OrderStatusPolling {
  const router = useRouter();
  const { reference, token } = input;
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<string | null>(null);
  const delay = pollDelayMs(attempt);

  useEffect(() => {
    if (delay === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const settle = (result: OrderStatusResult | 'error') => {
        if (cancelled) return;
        if (pollStep(result) === 'show') {
          setSettled(settledMessage(result));
          router.refresh();
        } else setAttempt((current) => current + 1);
      };
      check({ reference, token }).then(settle, () => {
        settle('error');
      });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [attempt, delay, reference, token, check, router]);

  const checkAgain = useCallback(() => {
    setAttempt(0);
  }, []);

  return { gaveUp: delay === null, settledMessage: settled, checkAgain };
}
