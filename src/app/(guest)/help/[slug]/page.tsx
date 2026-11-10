import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HelpArticleView } from '@/components/HelpCenter';
import { PageError } from '@/components/PageError';
import { helpArticleFallbackTitle, helpArticleHead } from '@/lib/pages/help';
import { helpArticlePath } from '@/lib/pages/help';
import { getHelpArticle } from '@/server/help';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';

// Not a slug, so the build's one prerender is a not-found that reads nothing: a build has no database to ask.
export function generateStaticParams() {
  return [{ slug: '_' }];
}

export async function generateMetadata({
  params,
}: PageProps<'/help/[slug]'>): Promise<Metadata> {
  try {
    return helpArticleHead(await getHelpArticle((await params).slug));
  } catch (error) {
    rethrowOrLog('The help article head could not be read', error);
    // The page reads the same article and shows the error state; the head only falls back to the plain title.
    return { title: helpArticleFallbackTitle };
  }
}

export default async function HelpArticleRoute({
  params,
}: PageProps<'/help/[slug]'>) {
  const { slug } = await params;
  let article;
  try {
    article = await getHelpArticle(slug);
  } catch (error) {
    rethrowOrLog('The help article could not be read', error);
    return (
      <PageError
        title={helpArticleFallbackTitle}
        alertTitle="We couldn't load this article"
        alertBody="Something went wrong on our side. Try again in a moment."
        retryHref={helpArticlePath(slug)}
      />
    );
  }
  if (!article) notFound();
  return <HelpArticleView article={article} />;
}
