import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { classNames } from '@/lib/classNames';
import { resolveBadgeTone, type BadgeTone } from '@/lib/badge';
import styles from './Badge.module.css';

export type BadgeProps = Omit<ComponentPropsWithoutRef<'span'>, 'children'> & {
  tone?: BadgeTone;
  label: string;
  icon?: ReactNode;
};

const toneClass = {
  green: styles.green,
  yellow: styles.yellow,
  blue: styles.blue,
  pink: styles.pink,
  neutral: styles.neutral,
} satisfies Record<BadgeTone, string | undefined>;

export function Badge({ tone, label, icon, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={classNames(styles.badge, toneClass[resolveBadgeTone(tone)])}
    >
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {label}
    </span>
  );
}
