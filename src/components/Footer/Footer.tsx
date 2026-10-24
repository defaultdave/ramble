import Link from 'next/link';
import type { ComponentPropsWithoutRef } from 'react';
import type { NavLink } from '@/components/Header';
import { Logo } from '@/components/Logo';
import styles from './Footer.module.css';

export type FooterLinkGroup = { title: string; links: NavLink[] };

export type FooterProps = Omit<
  ComponentPropsWithoutRef<'footer'>,
  'children' | 'className' | 'style'
> & {
  linkGroups: FooterLinkGroup[];
  tagline: string;
  copyright: string;
};

export function Footer({
  linkGroups,
  tagline,
  copyright,
  ...rest
}: FooterProps) {
  return (
    <footer {...rest} className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <div className={styles.brand}>
            <Logo />
            <p className={styles.tagline}>{tagline}</p>
          </div>
          <nav className={styles.groups} aria-label="Footer">
            {linkGroups.map((group) => (
              <div key={group.title} className={styles.group}>
                <h2 className={styles.groupTitle}>{group.title}</h2>
                <ul className={styles.list}>
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className={styles.link}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <p className={styles.copyright}>{copyright}</p>
      </div>
    </footer>
  );
}
