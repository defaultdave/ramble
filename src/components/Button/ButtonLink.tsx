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
  iconStart?: ReactNode;
  /** The address is another site's: it opens in a new tab, and says so to a screen reader. */
  external?: boolean;
  /** The address is a file to save under this name, not a page: it renders a plain anchor. */
  download?: string;
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
  iconStart,
  external = false,
  download,
}: ButtonLinkProps) {
  const className = classNames(
    styles.button,
    variantClass[variant],
    sizeClass[size],
  );
  const content = (
    <span className={styles.content}>
      {iconStart ? (
        <span className={styles.icon} aria-hidden="true">
          {iconStart}
        </span>
      ) : null}
      {children}
      {external ? (
        <span className={styles.visuallyHidden}> (opens in a new tab)</span>
      ) : null}
    </span>
  );
  if (download !== undefined) {
    return (
      <a href={href} download={download} className={className}>
        {content}
      </a>
    );
  }
  return external ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {content}
    </a>
  ) : (
    <Link
      href={href}
      // These go to a different filter state each; fetching them ahead would load pages nobody asked for.
      prefetch={false}
      className={className}
    >
      {content}
    </Link>
  );
}
