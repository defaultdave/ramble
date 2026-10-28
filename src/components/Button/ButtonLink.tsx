import Link from 'next/link';
import type { ReactNode } from 'react';
import { classNames } from '@/lib/classNames';
import type { ButtonSize, ButtonVariant } from './Button';
import styles from './Button.module.css';

export type ButtonLinkProps = {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variantClass = {
  primary: styles.primary,
  secondary: styles.secondary,
  ghost: styles.ghost,
} satisfies Record<ButtonVariant, string | undefined>;

const sizeClass = {
  md: styles.md,
  lg: styles.lg,
} satisfies Record<ButtonSize, string | undefined>;

/** A Button that goes to an address. It is a link, so it works with no script. */
export function ButtonLink({
  href,
  children,
  variant = 'ghost',
  size = 'md',
}: ButtonLinkProps) {
  return (
    <Link
      href={href}
      // These go to a different filter state each; fetching them ahead would load pages nobody asked for.
      prefetch={false}
      className={classNames(
        styles.button,
        variantClass[variant],
        sizeClass[size],
      )}
    >
      <span className={styles.content}>{children}</span>
    </Link>
  );
}
