import { useId } from 'react';
import { ExperienceCardItem } from '@/components/ExperienceCard';
import type { ExperienceCard } from '@/lib/experienceCards';
import styles from './HomeModules.module.css';

export type ThisWeekSectionProps = {
  heading: string;
  cards: readonly ExperienceCard[];
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
              <ExperienceCardItem
                card={card}
                layout="horizontal"
                headingLevel={3}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
