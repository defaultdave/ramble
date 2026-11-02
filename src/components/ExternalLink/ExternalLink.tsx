import type { ComponentPropsWithoutRef } from 'react';
import styles from './ExternalLink.module.css';

export type ExternalLinkProps = Omit<
  ComponentPropsWithoutRef<'a'>,
  'target' | 'rel' | 'style'
>;

/** A link to an address that opens in a new tab, and says so to a screen reader. */
export function ExternalLink({ children, ...rest }: ExternalLinkProps) {
  return (
    <a {...rest} target="_blank" rel="noopener noreferrer">
      {children}{' '}
      <span className={styles.visuallyHidden}>(opens in a new tab)</span>
    </a>
  );
}
