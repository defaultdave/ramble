import { Check, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { alertRole, type AlertTone } from '@/lib/alertTone';
import { classNames } from '@/lib/classNames';
import styles from './Alert.module.css';

export type { AlertTone };

export type AlertProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'title' | 'children' | 'role' | 'className' | 'style'
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

export function Alert({ tone, title, body, action, ...rest }: AlertProps) {
  const Icon = toneIcon[tone];

  return (
    <div
      {...rest}
      role={alertRole(tone)}
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
