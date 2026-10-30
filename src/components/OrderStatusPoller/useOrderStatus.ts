import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  pollDelayMs,
  pollStep,
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
  const delay = pollDelayMs(attempt);

  useEffect(() => {
    if (delay === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      check({ reference, token }).then(
        (result) => {
          if (cancelled) return;
          if (pollStep(result) === 'show') router.refresh();
          else setAttempt((current) => current + 1);
        },
        () => {
          if (!cancelled) setAttempt((current) => current + 1);
        },
      );
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [attempt, delay, reference, token, check, router]);

  const checkAgain = useCallback(() => {
    setAttempt(0);
  }, []);

  return { gaveUp: delay === null, checkAgain };
}
