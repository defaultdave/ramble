'use client';

import { LoaderCircle } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/Button';
import type { OrderStatusInput } from '@/lib/orderStatus';
import styles from './OrderStatusPoller.module.css';
import { useOrderStatus, type CheckOrderStatus } from './useOrderStatus';

export type OrderStatusPollerProps = OrderStatusInput & {
  check: CheckOrderStatus;
};

/** S9: the payment may have gone through while the page was not looking, so this keeps asking. */
export function OrderStatusPoller({
  reference,
  token,
  check,
}: OrderStatusPollerProps) {
  const { gaveUp, settledMessage, checkAgain } = useOrderStatus(
    { reference, token },
    check,
  );
  const region = useRef<HTMLDivElement>(null);

  // "Check again" unmounts itself, which would drop keyboard focus to the top of the document.
  const handleCheckAgain = () => {
    checkAgain();
    region.current?.focus();
  };

  return (
    <div role="status" tabIndex={-1} ref={region} className={styles.poller}>
      {gaveUp ? (
        <>
          <p className={styles.title}>This is taking longer than usual</p>
          <p className={styles.body}>
            Your payment has not shown up yet. Please do not pay again: check
            again in a moment, or look for the confirmation email.
          </p>
          <Button variant="secondary" onClick={handleCheckAgain}>
            Check again
          </Button>
        </>
      ) : (
        <>
          <p className={styles.title}>
            <LoaderCircle className={styles.spinner} aria-hidden="true" />
            {settledMessage ?? 'Checking your payment'}
          </p>
          <p className={styles.body}>
            We are confirming it with the bank. This page updates on its own, so
            there is no need to pay again.
          </p>
        </>
      )}
    </div>
  );
}
