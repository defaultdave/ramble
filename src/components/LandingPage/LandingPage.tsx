import type { ReactNode } from 'react';
import { ButtonLink } from '@/components/Button';
import { landingResultsId } from '@/lib/pages/landing';
import styles from './LandingPage.module.css';

export type LandingPageProps = {
  heading: string;
  /** The editor's opening words, already rendered, or nothing until copy is published. */
  intro: ReactNode;
  /** The same filters on browse, for a guest who wants to narrow by day or party. */
  browseHref: string;
  /** The experiences: the results, or the skeleton that holds their place. */
  results: ReactNode;
  /** The editor's longer copy, already rendered, shown under the results. */
  body: ReactNode;
};

/** A category or neighborhood page: the editor's intro over the experiences that match, then the longer copy. */
export function LandingPage({
  heading,
  intro,
  browseHref,
  results,
  body,
}: LandingPageProps) {
  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <h1 className={styles.title}>{heading}</h1>
        {intro}
        <div className={styles.action}>
          <ButtonLink href={browseHref} variant="secondary">
            Pick a day or narrow it down
          </ButtonLink>
        </div>
      </header>
      {/* With scripting off the results sit after the footer in the document, so this is the way to them. */}
      <noscript>
        <a className={styles.skipToResults} href={`#${landingResultsId}`}>
          Skip to results
        </a>
      </noscript>
      {results}
      {body ? <div className={styles.body}>{body}</div> : null}
    </div>
  );
}
