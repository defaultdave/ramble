'use client';

import { ExperienceCardItem } from '@/components/ExperienceCard';
import type { ExperienceCard } from '@/lib/experienceCards';
import styles from './BrowseCardGrid.module.css';

export type BrowseCardGridProps = { cards: ExperienceCard[] };

/**
 * A client component so the cards cross the server boundary as one plain-data prop instead of one
 * server element each. React Flight defers elements once a row passes about 3,200 bytes, and with
 * scripting off the deferred pieces arrive as hidden segments that nothing moves into place.
 */
export function BrowseCardGrid({ cards }: BrowseCardGridProps) {
  return (
    <ul className={styles.grid}>
      {cards.map((card, index) => (
        <li key={card.id} className={styles.item}>
          <ExperienceCardItem
            card={card}
            layout="vertical"
            headingLevel={2}
            preloadPhoto={index === 0}
          />
        </li>
      ))}
    </ul>
  );
}
