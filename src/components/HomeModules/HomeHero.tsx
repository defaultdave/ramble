import { ChevronDown, Search, Star } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { Illustration } from '@/components/Illustration';
import { Input } from '@/components/Input';
import { browseParamNames } from '@/lib/filters';
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
 * script: the neighborhood and day become the `neighborhood` and `date` of the browse address. The day starts as today, and
 * the guest can clear it to search any day.
 */
export function HomeHero({
  eyebrow,
  heading,
  body,
  neighborhoods,
  today,
}: HomeHeroProps) {
  const headingId = useId();
  const neighborhoodId = useId();

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
              <label className={styles.label} htmlFor={neighborhoodId}>
                Neighborhood
              </label>
              <div className={styles.select}>
                <select
                  id={neighborhoodId}
                  className={styles.selectControl}
                  name={browseParamNames.neighborhoods}
                  defaultValue=""
                >
                  <option value="">Anywhere in New York</option>
                  {neighborhoods.map(({ slug, name }) => (
                    <option key={slug} value={slug}>
                      {name}
                    </option>
                  ))}
                </select>
                <ChevronDown className={styles.chevron} aria-hidden="true" />
              </div>
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
