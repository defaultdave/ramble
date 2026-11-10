import Link from 'next/link';
import { RichText } from '@/components/RichText';
import type { HelpArticle } from '@/lib/editorial';
import { contactPath, helpPath } from '@/lib/paths';
import styles from './HelpCenter.module.css';

export type HelpArticleViewProps = {
  article: Pick<HelpArticle, 'title' | 'summary' | 'body'>;
};

export function HelpArticleView({ article }: HelpArticleViewProps) {
  return (
    <article className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.link} href={helpPath}>
          All help articles
        </Link>
        <h1 className={styles.title}>{article.title}</h1>
        {article.summary ? (
          <p className={styles.summary}>{article.summary}</p>
        ) : null}
      </header>
      <RichText content={article.body} />
      <p className={styles.more}>
        Still stuck?{' '}
        <Link className={styles.link} href={contactPath}>
          Contact us
        </Link>
        .
      </p>
    </article>
  );
}
