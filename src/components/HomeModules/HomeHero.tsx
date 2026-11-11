import { Search, Star } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { Illustration } from '@/components/Illustration';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import {
  browseParamNames,
  defaultGuests,
  guestOptions,
  neighborhoodOptions,
} from '@/lib/filters';
import { browsePath } from '@/lib/routes';
import { Eyebrow } from './Eyebrow';
import styles from './HomeHero.module.css';

export type HomeHeroProps = {
  eyebrow: string;
  heading: string;
  /** The module's copy, already rendered. */
  body: ReactNode;
  neighborhoods: readonly { slug: string; name: string }[];
  /** Today in New York as YYYY-MM-DD: the date field's starting day and the earliest it offers. */
  today: string;
};

/**
 * The hero and its search. The search is a plain GET form to the browse page, so it works with no
 * script: the neighborhood, day, and party become the `neighborhood`, `date`, and `guests` of the browse address. The day
 * starts as today and the guest can clear it to search any day; the party starts at two.
 */
export function HomeHero({
  eyebrow,
  heading,
  body,
  neighborhoods,
  today,
}: HomeHeroProps) {
  const headingId = useId();

  return (
    <section className={styles.hero} aria-labelledby={headingId}>
      <div className={styles.inner}>
        <div className={styles.copy}>
          <Eyebrow icon={<Star />} label={eyebrow} />
          <h1 id={headingId} className={styles.heading}>
            {heading}
          </h1>
          <div className={styles.body}>{body}</div>
          <form
            className={styles.search}
            action={browsePath}
            method="get"
            aria-label="Find something to do"
          >
            <div className={styles.field}>
              <Select
                variant="hero"
                label="Neighborhood"
                name={browseParamNames.neighborhoods}
                defaultValue=""
                options={neighborhoodOptions(neighborhoods)}
              />
            </div>
            <div className={styles.field}>
              <Input
                type="date"
                name={browseParamNames.date}
                label="When"
                min={today}
                defaultValue={today}
              />
            </div>
            <div className={styles.field}>
              <Select
                variant="hero"
                label="Guests"
                name={browseParamNames.guests}
                defaultValue={String(defaultGuests)}
                options={guestOptions}
              />
            </div>
            <div className={styles.submit}>
              <Button type="submit" size="lg" iconStart={<Search />}>
                Find something to do
              </Button>
            </div>
          </form>
        </div>
        <div className={styles.art}>
          <Illustration width={416} height={312} />
        </div>
      </div>
    </section>
  );
}
