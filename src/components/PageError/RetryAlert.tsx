import type { ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import styles from './RetryAlert.module.css';

export type RetryAlertProps = {
  alertTitle: string;
  alertBody: string;
  /** The Try again form. It sits under the alert as its own button, because inside the alert it would read as a link. */
  children: ReactNode;
};

/** A danger alert with its Try again control below it: full width on a phone, its label's width from tablet up. */
export function RetryAlert({
  alertTitle,
  alertBody,
  children,
}: RetryAlertProps) {
  return (
    <div className={styles.root}>
      <Alert tone="danger" title={alertTitle} body={alertBody} />
      {children}
    </div>
  );
}
