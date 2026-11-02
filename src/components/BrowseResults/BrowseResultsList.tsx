'use client';

import { ButtonLink } from '@/components/Button';
import { ExperienceCardItem } from '@/components/ExperienceCard';
import type { ExperienceCard } from '@/lib/experienceCards';
import type { FormTarget } from '@/lib/pages/browse';
import styles from './BrowseResultsList.module.css';
import { TargetButton } from './TargetButton';

export type BrowseResultsListProps = {
  cards: ExperienceCard[];
  showMore: FormTarget | null;
  startHref: string | null;
};

/**
 * A client component so the cards and the controls under them cross the server boundary as plain
 * data instead of one server element each. React Flight defers elements once a row passes about
 * 3,200 bytes, and with scripting off the deferred pieces arrive as hidden segments that nothing
 * moves into place.
 */
export function BrowseResultsList({
  cards,
  showMore,
  startHref,
}: BrowseResultsListProps) {
  return (
    <>
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
      <div className={styles.more}>
        {showMore ? (
          <TargetButton
            target={showMore}
            label="Show more"
            variant="secondary"
          />
        ) : null}
        {startHref ? (
          <ButtonLink href={startHref}>Back to the first results</ButtonLink>
        ) : null}
      </div>
    </>
  );
}
