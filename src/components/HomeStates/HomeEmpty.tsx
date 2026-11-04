import Link from 'next/link';
import { PageHeading } from '@/components/PageHeading';
import { browsePath } from '@/lib/routes';
import { brandName } from '@/lib/pages/brand';
import styles from './HomeStates.module.css';

/** What the page shows when no home module is switched on, so it is never a bare header and footer. */
export function HomeEmpty() {
  return (
    <PageHeading title={brandName}>
      <p>
        We are still putting the home page together. Everything that is on is a
        click away.
      </p>
      <Link className={styles.link} href={browsePath}>
        Browse experiences
      </Link>
    </PageHeading>
  );
}
