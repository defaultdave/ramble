import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/Badge';
import { PageError } from '@/components/PageError';
import { PageHeading } from '@/components/PageHeading';
import { RichText } from '@/components/RichText';
import { LegalDocSchema } from '@/lib/legal';
import {
  buildLegalView,
  legalFallbackTitle,
  legalHead,
} from '@/lib/pages/legal';
import { legalDocPath } from '@/lib/routes';
import { getLegalPage } from '@/server/legalPage';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import styles from './page.module.css';

export function generateStaticParams() {
  return [{ doc: 'sample' }];
}

export async function generateMetadata({
  params,
}: PageProps<'/legal/[doc]'>): Promise<Metadata> {
  const { doc } = await params;
  if (!LegalDocSchema.safeParse(doc).success) return legalHead(null);
  try {
    return legalHead(await getLegalPage(doc));
  } catch (error) {
    rethrowOrLog('The legal document head could not be read', error);
    // The page reads the same document and shows the error state; the head only falls back to the plain title.
    return { title: legalFallbackTitle };
  }
}

export default async function LegalPage({ params }: PageProps<'/legal/[doc]'>) {
  const { doc } = await params;
  if (!LegalDocSchema.safeParse(doc).success) notFound();

  let document;
  try {
    document = await getLegalPage(doc);
  } catch (error) {
    rethrowOrLog('The legal document could not be read', error);
    return (
      <PageError
        title={legalFallbackTitle}
        alertTitle="We couldn't load this document"
        alertBody="Something went wrong on our side. Try again in a moment."
        retryHref={legalDocPath(doc)}
      />
    );
  }
  if (!document) notFound();

  const view = buildLegalView(document);
  return (
    <PageHeading title={view.title}>
      <div className={styles.demo}>
        <Badge tone="yellow" label={view.demoLabel} />
      </div>
      <RichText content={view.body} />
    </PageHeading>
  );
}
