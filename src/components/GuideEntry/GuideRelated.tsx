import { useId } from 'react';
import { ExperienceCardItem } from '@/components/ExperienceCard';
import type { ExperienceCard } from '@/lib/experienceCards';
import styles from './GuideEntry.module.css';

export type GuideRelatedProps = {
  /** The entry's category, in the heading: "Cooking you can book". */
  categoryName: string;
  cards: readonly ExperienceCard[];
};

/** Bookable experiences in the entry's category. Nothing at all when there are none: an empty module says nothing useful. */
export function GuideRelated({ categoryName, cards }: GuideRelatedProps) {
  const headingId = useId();
  if (cards.length === 0) return null;
  return (
    <section className={styles.related} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.relatedHeading}>
        {categoryName} you can book
      </h2>
      <ul className={styles.relatedList} role="list">
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
    </section>
  );
}
