import { Check, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { classNames } from '@/lib/classNames';
import styles from './Alert.module.css';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

export type AlertProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'title' | 'children' | 'role'
> & {
  tone: AlertTone;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
};

const toneClass = {
  info: styles.info,
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
} satisfies Record<AlertTone, string | undefined>;

const toneIcon = {
  info: Info,
  success: Check,
  warning: TriangleAlert,
  danger: TriangleAlert,
} satisfies Record<AlertTone, LucideIcon>;

// Warnings and errors interrupt; confirmations and notes wait their turn.
const toneRole = {
  info: 'status',
  success: 'status',
  warning: 'alert',
  danger: 'alert',
} satisfies Record<AlertTone, 'status' | 'alert'>;

export function Alert({ tone, title, body, action, ...rest }: AlertProps) {
  const Icon = toneIcon[tone];

  return (
    <div
      {...rest}
      role={toneRole[tone]}
      className={classNames(styles.alert, toneClass[tone])}
    >
      <Icon className={styles.icon} aria-hidden="true" />
      <div className={styles.content}>
        <p className={styles.title}>{title}</p>
        {body ? <div className={styles.body}>{body}</div> : null}
        {action ? <div className={styles.action}>{action}</div> : null}
      </div>
    </div>
  );
}
