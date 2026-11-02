import type { ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { classNames } from '@/lib/classNames';
import styles from './RetryAlert.module.css';

export type RetryAlertProps = {
  alertTitle: string;
  alertBody: string;
  /** The Try again form. It sits under the alert as its own button, because inside the alert it would read as a link. */
  children: ReactNode;
  /** From the tablet width up the alert takes its content's width instead of the container's. */
  fit?: boolean;
};

/** A danger alert with its Try again control below it: full width on a phone, its label's width from tablet up. */
export function RetryAlert({
  alertTitle,
  alertBody,
  children,
  fit = false,
}: RetryAlertProps) {
  return (
    <div className={classNames(styles.root, fit && styles.fit)}>
      <Alert tone="danger" title={alertTitle} body={alertBody} />
      {children}
    </div>
  );
}
