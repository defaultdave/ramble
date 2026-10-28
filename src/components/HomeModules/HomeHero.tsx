import { ChevronDown, Search, Star } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { Illustration } from '@/components/Illustration';
import { Input } from '@/components/Input';
import { browsePath } from '@/lib/home';
import { Eyebrow } from './Eyebrow';
import styles from './HomeHero.module.css';

export type HomeHeroProps = {
  eyebrow: string;
  heading: string;
  /** The module's copy, already rendered. */
  body: ReactNode;
  neighborhoods: readonly { slug: string; name: string }[];
  /** The earliest day the date field offers, as YYYY-MM-DD. */
  minDate: string;
};

/**
 * The hero and its search. The search is a plain GET form to the browse page, so it works with no
 * script: the neighborhood and day become the `neighborhood` and `date` of the browse address.
 */
export function HomeHero({
  eyebrow,
  heading,
  body,
  neighborhoods,
  minDate,
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
                  name="neighborhood"
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
              <Input type="date" name="date" label="When" min={minDate} />
            </div>
            <div className={styles.submit}>
              <Button type="submit" iconStart={<Search />}>
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
