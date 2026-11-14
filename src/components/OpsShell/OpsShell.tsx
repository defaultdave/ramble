import Link from 'next/link';
import { ButtonLink } from '@/components/Button';
import { PageHeading } from '@/components/PageHeading';
import { signInHref } from '@/lib/signIn';
import type { OpsNavLink } from '@/lib/opsNav';
import styles from './OpsShell.module.css';

export function OpsNav({ links }: { links: readonly OpsNavLink[] }) {
  return (
    <nav aria-label="Operations" className={styles.nav}>
      <ul className={styles.navList}>
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className={styles.navLink}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function OpsLanding({ areas }: { areas: readonly OpsNavLink[] }) {
  return (
    <PageHeading title="Operations">
      <p>Tools for the Ramble team.</p>
      <ul className={styles.areas} aria-label="Areas">
        {areas.map((area) => (
          <li key={area.href} className={styles.area}>
            <Link href={area.href} className={styles.areaLink}>
              {area.label}
            </Link>
            <span className={styles.summary}>{area.summary}</span>
          </li>
        ))}
      </ul>
    </PageHeading>
  );
}

/** What anyone without the ops role sees, whether signed out or signed in as someone else. */
export function OpsAccessDenied({
  next,
  title = 'Operations',
}: {
  next: string;
  /** The page's own heading, for a page whose title is not the area's. */
  title?: string;
}) {
  return (
    <PageHeading title={title}>
      <p>
        This area is for the Ramble team. Sign in with a team account to
        continue.
      </p>
      <ButtonLink href={signInHref(next)} variant="secondary">
        Sign in
      </ButtonLink>
    </PageHeading>
  );
}
