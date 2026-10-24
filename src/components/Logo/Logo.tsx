import type { ComponentPropsWithoutRef } from 'react';
import styles from './Logo.module.css';

export type LogoProps = Omit<
  ComponentPropsWithoutRef<'span'>,
  'children' | 'className' | 'style'
>;

export function Logo(props: LogoProps) {
  return (
    <span {...props} className={styles.logo}>
      ramble
    </span>
  );
}
