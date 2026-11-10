'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useDismissableDetails } from '@/components/Disclosure/useDismissableDetails';
import type { SiteLink } from '@/lib/pages/siteNav';
import styles from './SiteMenu.module.css';

export type SiteMenuProps = {
  links: readonly SiteLink[];
  /** The sign-in or sign-out control, last in the panel. The header shows its own from tablet up. */
  account?: ReactNode;
};

/**
 * The phone header's menu. A native disclosure, so it opens and closes with no script and the
 * browser keeps its expanded state for assistive technology. Script adds Escape (focus returns
 * to the button), a press outside, focus tabbing out, and a link click, which close it.
 */
export function SiteMenu({ links, account }: SiteMenuProps) {
  const { details, summary, onKeyDown, onBlur, onClick } =
    useDismissableDetails();
  return (
    <details
      ref={details}
      className={styles.menu}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onClick={onClick}
    >
      <summary ref={summary} className={styles.summary}>
        <Menu aria-hidden="true" />
        <span className={styles.visuallyHidden}>Menu</span>
      </summary>
      <nav className={styles.panel} aria-label="Main menu">
        <ul className={styles.list} role="list">
          {links.map(({ label, href }) => (
            <li key={href}>
              <Link className={styles.link} href={href}>
                {label}
              </Link>
            </li>
          ))}
        </ul>
        {account ? <div className={styles.account}>{account}</div> : null}
      </nav>
    </details>
  );
}
