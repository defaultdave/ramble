'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { useDismissableDetails } from '@/components/Disclosure/useDismissableDetails';
import type { SiteLink } from '@/lib/pages/siteNav';
import styles from './SiteMenu.module.css';

export type SiteMenuProps = { links: readonly SiteLink[] };

/**
 * The phone header's menu. A native disclosure, so it opens and closes with no script and the
 * browser keeps its expanded state for assistive technology. Script adds Escape (focus returns
 * to the button) and a press outside, which close it.
 */
export function SiteMenu({ links }: SiteMenuProps) {
  const { details, summary, onKeyDown } = useDismissableDetails();
  return (
    <details ref={details} className={styles.menu} onKeyDown={onKeyDown}>
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
      </nav>
    </details>
  );
}
