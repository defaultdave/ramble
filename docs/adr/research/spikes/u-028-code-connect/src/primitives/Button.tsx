import type { ButtonHTMLAttributes, ReactNode } from 'react';

// Mirrors the Figma Button component: props are named after the Figma variant properties (ADR 0005).
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'md' | 'lg';
  loading?: boolean;
  iconStart?: ReactNode;
  children: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', loading = false, iconStart, children, disabled, ...rest }: ButtonProps) {
  return (
    <button data-variant={variant} data-size={size} data-loading={loading || undefined} disabled={disabled || loading} {...rest}>
      {iconStart}
      {children}
    </button>
  );
}
