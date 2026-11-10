import { Clock, ExternalLink, Info, MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { Badge } from '@/components/Badge';
import { Photo } from '@/components/Photo';
import type { GuideEntryView } from '@/lib/pages/guide';
import styles from './GuideEntry.module.css';

export type GuideEntryProps = {
  entry: GuideEntryView;
  /** The "you can book" module, which streams in after the page. */
  related: ReactNode;
};

// A paid link says so to search engines; every link out leaves the site without a referrer.
const sponsoredRel = 'sponsored noopener noreferrer';
const plainRel = 'noopener noreferrer';

/** A guide-only entry: described, never bookable here, with the way to the host's own site. */
export function GuideEntry({ entry, related }: GuideEntryProps) {
  const { outbound, hostName } = entry;
  return (
    <article className={styles.page}>
      <div className={styles.photo}>
        {entry.cover ? (
          <Photo photo={entry.cover} sizes="(min-width: 768px) 768px, 100vw" />
        ) : null}
      </div>
      <div className={styles.body}>
        <header className={styles.header}>
          <Badge tone="yellow" label="From the Ramble guide" icon={<Info />} />
          <h1 className={styles.title}>{entry.title}</h1>
          <ul className={styles.facts} role="list">
            <li className={styles.fact}>
              <MapPin className={styles.factIcon} aria-hidden="true" />
              {entry.neighborhoodName}
            </li>
            {entry.duration ? (
              <li className={styles.fact}>
                <Clock className={styles.factIcon} aria-hidden="true" />
                {entry.duration}
              </li>
            ) : null}
          </ul>
        </header>

        <section className={styles.notice} aria-label="Booking">
          <Alert
            tone="info"
            title="Not bookable on Ramble"
            body={
              outbound
                ? `Book directly with ${hostName}. Price and availability are theirs to set.`
                : `We don't have a booking link for ${hostName} yet.`
            }
          />
          {outbound ? (
            <>
              <a
                className={styles.link}
                href={outbound.href}
                target="_blank"
                rel={outbound.sponsored ? sponsoredRel : plainRel}
              >
                <ExternalLink className={styles.linkIcon} aria-hidden="true" />
                <span>
                  Visit {hostName}&rsquo;s site
                  <span className={styles.visuallyHidden}>
                    {' '}
                    (opens in a new tab)
                  </span>
                </span>
              </a>
              {outbound.sponsored ? (
                <p className={styles.disclosure}>
                  Ramble may earn a commission if you book through this link.
                </p>
              ) : null}
            </>
          ) : null}
        </section>

        {entry.about.length > 0 ? (
          <div className={styles.about}>
            {entry.about.map((paragraph) => (
              <p key={paragraph} className={styles.text}>
                {paragraph}
              </p>
            ))}
          </div>
        ) : null}

        {related}
      </div>
    </article>
  );
}
