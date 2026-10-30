import {
  CloudSun,
  Check,
  Clock,
  Gift,
  MapPin,
  Trees,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { Badge } from '@/components/Badge';
import { ButtonLink } from '@/components/Button';
import { ExperienceGallery } from '@/components/ExperienceGallery';
import type { ExperiencePageView, KeyFactIcon } from '@/lib/pages/experience';
import styles from './ExperiencePage.module.css';

export type ExperiencePageProps = {
  view: ExperiencePageView;
  /** The upcoming dates, which the route streams in behind a skeleton of their own height. */
  dates: ReactNode;
};

const factIcon = {
  place: MapPin,
  duration: Clock,
  age: Users,
  weather: CloudSun,
  cancellation: Check,
} satisfies Record<KeyFactIcon, LucideIcon>;

function Section({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {heading}
      </h2>
      {children}
    </section>
  );
}

/**
 * The content of an experience page: its photos, what it is, what it costs, and the terms a guest
 * agrees to before choosing a date, with the upcoming dates in a slot the route fills. The
 * booking controls are another unit's.
 */
export function ExperiencePage({ view, dates }: ExperiencePageProps) {
  return (
    <article className={styles.page}>
      <header className={styles.header}>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <ol className={styles.crumbs}>
            {view.breadcrumb.map((crumb) => (
              <li key={crumb.href}>
                <Link href={crumb.href} className={styles.crumb}>
                  {crumb.label}
                </Link>
              </li>
            ))}
            <li aria-current="page">{view.title}</li>
          </ol>
        </nav>
        {view.badges.length > 0 ? (
          <ul className={styles.badges} role="list">
            {view.badges.map((badge) => (
              <li key={badge.label}>
                <Badge
                  tone={badge.tone}
                  label={badge.label}
                  icon={badge.icon === 'outdoor' ? <Trees /> : undefined}
                />
              </li>
            ))}
          </ul>
        ) : null}
        <h1 className={styles.title}>{view.title}</h1>
        <p className={styles.summary}>{view.summary}</p>
      </header>

      <div className={styles.gallery}>
        <ExperienceGallery title={view.title} gallery={view.gallery} />
      </div>

      <div className={styles.body}>
        <div className={styles.facts}>
          {view.prices.length > 0 ? (
            <ul className={styles.prices} role="list">
              {view.prices.map((price) => (
                <li key={price.unit} className={styles.price}>
                  <span className={styles.amount}>{price.amount}</span>{' '}
                  <span className={styles.unit}>{price.unit}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <ul className={styles.keyFacts} role="list">
            {view.keyFacts.map((fact) => {
              const Icon = factIcon[fact.icon];
              return (
                <li key={fact.icon} className={styles.keyFact}>
                  <Icon className={styles.keyFactIcon} aria-hidden="true" />
                  {fact.text}
                </li>
              );
            })}
          </ul>
        </div>

        <Section heading="Upcoming dates">{dates}</Section>

        {/* TODO(U-041): the booking bar and sheet on a phone, and the panel beside this column from the tablet width. */}
        <div className={styles.action}>
          <ButtonLink href={view.bookHref} variant="primary" size="lg">
            Book
          </ButtonLink>
        </div>

        {view.about.length > 0 ? (
          <Section heading="About">
            <div className={styles.prose}>
              {view.about.map((paragraph) => (
                <p key={paragraph} className={styles.text}>
                  {paragraph}
                </p>
              ))}
            </div>
          </Section>
        ) : null}

        {view.included.length > 0 ? (
          <Section heading="What's included">
            <ul className={styles.included} role="list">
              {view.included.map((item) => (
                <li key={item} className={styles.keyFact}>
                  <Check className={styles.keyFactIcon} aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section heading="Your host">
          <div className={styles.host}>
            <span className={styles.avatar} aria-hidden="true">
              {view.host.initial}
            </span>
            <div className={styles.hostText}>
              <p className={styles.hostName}>{view.host.name}</p>
              {view.host.description ? (
                <p className={styles.hostAbout}>{view.host.description}</p>
              ) : null}
            </div>
          </div>
        </Section>

        {view.meeting ? (
          <Section heading="Meeting point">
            <p className={styles.text}>{view.meeting.text}</p>
            {view.meeting.mapsHref ? (
              <div className={styles.action}>
                <ButtonLink
                  href={view.meeting.mapsHref}
                  external
                  iconStart={<MapPin />}
                >
                  Open in Maps
                </ButtonLink>
              </div>
            ) : null}
          </Section>
        ) : null}

        {view.accessibility ? (
          <Section heading="Accessibility">
            <p className={styles.text}>{view.accessibility}</p>
          </Section>
        ) : null}

        {view.weather ? (
          <Section heading="Weather">
            <p className={styles.text}>{view.weather}</p>
          </Section>
        ) : null}

        <Section heading="Cancellation">
          <p className={styles.text}>{view.cancellation}</p>
        </Section>

        <div className={styles.entries}>
          {view.giftHref ? (
            <ButtonLink
              href={view.giftHref}
              variant="secondary"
              iconStart={<Gift />}
            >
              Give this as a gift
            </ButtonLink>
          ) : null}
          <Link href={view.privateSessionHref} className={styles.textLink}>
            Booking for 8 or more? Ask about a private session
          </Link>
        </div>
      </div>
    </article>
  );
}
