import { useId } from 'react';
import { ChipLink } from '@/components/Chip';
import type { HomeCategory } from '@/lib/pages/home';
import styles from './HomeModules.module.css';

export type CategoryRailProps = {
  heading: string;
  categories: readonly HomeCategory[];
};

export function CategoryRail({ heading, categories }: CategoryRailProps) {
  const headingId = useId();

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.inner}>
        <h2 id={headingId} className={styles.heading}>
          {heading}
        </h2>
        <ul className={styles.pills} role="list">
          {categories.map(({ slug, name, href }) => (
            <li key={slug}>
              <ChipLink label={name} href={href} selected={false} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
