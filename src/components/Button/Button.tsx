'use client';

import { LoaderCircle } from 'lucide-react';
import type {
  ComponentPropsWithoutRef,
  MouseEventHandler,
  ReactNode,
} from 'react';
import { classNames } from '@/lib/classNames';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'md' | 'lg';

export type ButtonProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  'className' | 'style'
> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconStart?: ReactNode;
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

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  iconStart,
  disabled = false,
  type = 'button',
  onClick,
  children,
  ...rest
}: ButtonProps) {
  // Loading blocks activation in the handler, not with native disabled, so the button keeps focus.
  const handleClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-disabled={loading || undefined}
      onClick={handleClick}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      className={classNames(
        styles.button,
        variantClass[variant],
        sizeClass[size],
      )}
    >
      {/* The label stays in the layout while loading so the width never changes. */}
      <span className={styles.content}>
        {iconStart ? (
          <span className={styles.icon} aria-hidden="true">
            {iconStart}
          </span>
        ) : null}
        {children}
      </span>
      {loading ? (
        <LoaderCircle className={styles.spinner} aria-hidden="true" />
      ) : null}
    </button>
  );
}
