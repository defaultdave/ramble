import { Menu } from 'lucide-react';
import Link from 'next/link';
import type { SiteLink } from '@/lib/siteNav';
import styles from './SiteMenu.module.css';

export type SiteMenuProps = { links: readonly SiteLink[] };

/**
 * The phone header's menu. A native disclosure, so it opens and closes with no script and the
 * browser keeps its expanded state for assistive technology.
 */
export function SiteMenu({ links }: SiteMenuProps) {
  return (
    <details className={styles.menu}>
      <summary className={styles.summary}>
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
