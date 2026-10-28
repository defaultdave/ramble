import { Star } from 'lucide-react';
import Link from 'next/link';
import { useId } from 'react';
import { classNames } from '@/lib/classNames';
import type { HomeCard } from '@/lib/home';
import { Eyebrow } from './Eyebrow';
import { HomeCardItem } from './HomeCardItem';
import styles from './HomeModules.module.css';

export type PicksSectionProps = {
  /** Set on the first Picks module, so the header and footer can link to it. */
  anchor?: string | undefined;
  eyebrow: string;
  heading: string;
  summary: string | null;
  cards: readonly HomeCard[];
  seeAll: { href: string; label: string };
};

export function PicksSection({
  anchor,
  eyebrow,
  heading,
  summary,
  cards,
  seeAll,
}: PicksSectionProps) {
  const headingId = useId();

  return (
    <section id={anchor} className={styles.section} aria-labelledby={headingId}>
      <div className={styles.picks}>
        <div className={styles.picksHead}>
          <Eyebrow icon={<Star />} label={eyebrow} />
          <h2 id={headingId} className={styles.headingLarge}>
            {heading}
          </h2>
          {summary ? <p className={styles.summary}>{summary}</p> : null}
        </div>
        <ul className={classNames(styles.rail, styles.picksCards)} role="list">
          {cards.map((card) => (
            <li key={card.id}>
              <HomeCardItem card={card} layout="vertical" />
            </li>
          ))}
        </ul>
        <Link
          className={classNames(styles.link, styles.picksMore)}
          href={seeAll.href}
        >
          {seeAll.label}
        </Link>
      </div>
    </section>
  );
}
