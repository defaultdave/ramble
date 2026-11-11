import Link from 'next/link';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import {
  helpArticlePath,
  helpSearchMaxLength,
  type HelpIndexView,
} from '@/lib/pages/help';
import { contactPath, helpPath } from '@/lib/paths';
import styles from './HelpCenter.module.css';

export type HelpIndexProps = {
  view: HelpIndexView;
};

const countLabel = (count: number) =>
  `${String(count)} ${count === 1 ? 'article matches' : 'articles match'}`;

/** The help center's front page: a search that works with no script, and the articles it finds or all of them. */
export function HelpIndex({ view }: HelpIndexProps) {
  const query = view.kind === 'articles' ? null : view.query;
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Help</h1>
        <p className={styles.lede}>
          Answers about booking, changing a booking, gifts, and hosting.
        </p>
      </div>
      <form
        className={styles.search}
        action={helpPath}
        method="get"
        role="search"
      >
        <Input
          label="Search help articles"
          name="q"
          type="search"
          defaultValue={query ?? ''}
          maxLength={helpSearchMaxLength}
          autoComplete="off"
        />
        <Button type="submit">Search</Button>
      </form>
      <Results view={view} />
      <p className={styles.more}>
        Can&apos;t find what you need?{' '}
        <Link className={styles.link} href={contactPath}>
          Contact us
        </Link>
        .
      </p>
    </div>
  );
}

function Results({ view }: HelpIndexProps) {
  if (view.kind === 'none') {
    return (
      <section className={styles.section} aria-labelledby="help-results">
        <h2 id="help-results" className={styles.heading}>
          No articles match &ldquo;{view.query}&rdquo;
        </h2>
        <p>Try a shorter word, or look through every article.</p>
        <Link className={styles.link} href={helpPath}>
          See all help articles
        </Link>
      </section>
    );
  }
  return (
    <section aria-labelledby="help-results" className={styles.section}>
      <h2 id="help-results" className={styles.heading}>
        {view.kind === 'results'
          ? `${countLabel(view.articles.length)} “${view.query}”`
          : 'All help articles'}
      </h2>
      <ul className={styles.list} role="list">
        {view.articles.map((article) => (
          <li key={article.id} className={styles.item}>
            <Link
              className={styles.itemLink}
              href={helpArticlePath(article.slug)}
            >
              {article.title}
            </Link>
            {article.summary ? (
              <p className={styles.itemSummary}>{article.summary}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {view.kind === 'results' ? (
        <Link className={styles.link} href={helpPath}>
          See all help articles
        </Link>
      ) : null}
    </section>
  );
}
