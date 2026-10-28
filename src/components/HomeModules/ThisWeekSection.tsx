import { useId } from 'react';
import type { HomeCard } from '@/lib/home';
import { HomeCardItem } from './HomeCardItem';
import styles from './HomeModules.module.css';

export type ThisWeekSectionProps = {
  heading: string;
  cards: readonly HomeCard[];
};

export function ThisWeekSection({ heading, cards }: ThisWeekSectionProps) {
  const headingId = useId();

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.inner}>
        <h2 id={headingId} className={styles.heading}>
          {heading}
        </h2>
        <ul className={styles.stack} role="list">
          {cards.map((card) => (
            <li key={card.id}>
              <HomeCardItem card={card} layout="horizontal" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
