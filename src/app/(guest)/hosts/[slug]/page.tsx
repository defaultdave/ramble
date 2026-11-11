import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BrowseResults } from '@/components/BrowseResults';
import { PageError } from '@/components/PageError';
import {
  hostFallbackTitle,
  hostHead,
  hostNotFoundTitle,
  hostPageView,
  hostPlaceholderSlug,
  isHostSlug,
} from '@/lib/pages/host';
import { hostPath } from '@/lib/routes';
import { getHostPage } from '@/server/hostPage';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import styles from './page.module.css';

// The build has no database to list hosts from, so it prerenders the placeholder; a real host
// renders on its first request and is kept by the cached read under it.
export function generateStaticParams() {
  return [{ slug: hostPlaceholderSlug }];
}

export async function generateMetadata({
  params,
}: PageProps<'/hosts/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  if (!isHostSlug(slug)) return { title: hostNotFoundTitle };
  try {
    const data = await getHostPage(slug);
    const { title, description } = hostHead(data?.host ?? null);
    return description === null ? { title } : { title, description };
  } catch (error) {
    rethrowOrLog('The host head could not be read', error);
    // The page reads the same entry and shows the error state; the head only falls back to the plain title.
    return { title: hostFallbackTitle };
  }
}

export default async function HostRoute({
  params,
}: PageProps<'/hosts/[slug]'>) {
  const { slug } = await params;
  if (!isHostSlug(slug)) notFound();

  let data;
  try {
    data = await getHostPage(slug);
  } catch (error) {
    rethrowOrLog('The host page could not be read', error);
    return (
      <PageError
        title={hostFallbackTitle}
        alertTitle="We couldn't load this host"
        alertBody="Something went wrong on our side. Try again in a moment."
        retryHref={hostPath(slug)}
      />
    );
  }
  if (!data) notFound();

  const view = hostPageView(data);
  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <span className={styles.avatar} aria-hidden="true">
          {view.initial}
        </span>
        <h1 className={styles.title}>{view.name}</h1>
      </header>

      {view.about.length > 0 ? (
        <section className={styles.section} aria-labelledby="host-about">
          <h2 id="host-about" className={styles.heading}>
            About
          </h2>
          <div className={styles.prose}>
            {view.about.map((paragraph) => (
              <p key={paragraph} className={styles.text}>
                {paragraph}
              </p>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="host-experiences">
        <h2 id="host-experiences" className={styles.heading}>
          Experiences
        </h2>
        <BrowseResults {...view.results} />
      </section>

      {view.cancellation ? (
        <section className={styles.section} aria-labelledby="host-cancellation">
          <h2 id="host-cancellation" className={styles.heading}>
            Cancellation
          </h2>
          {view.cancellation.kind === 'shared' ? (
            <p className={styles.text}>{view.cancellation.text}</p>
          ) : (
            <ul className={styles.terms} role="list">
              {view.cancellation.rows.map(({ id, title, text }) => (
                <li key={id} className={styles.text}>
                  <span className={styles.termsTitle}>{title}</span>: {text}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
