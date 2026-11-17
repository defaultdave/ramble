import type { Metadata } from 'next';
import { connection } from 'next/server';
import { ReviewForm } from '@/components/ReviewForm';
import { reviewCopy } from '@/lib/copy/review';
import { reviewView } from '@/lib/reviews';
import { submitReviewForm } from '@/server/actions/reviews';
import { readReviewDraft } from '@/server/reviewDraft';
import { readReviewPage } from '@/server/reviewForm';

// The address is a capability, so nothing here may describe the booking: a generic title, no
// description, and no Open Graph or Twitter card, so a pasted link unfurls to nothing. The policy
// is `origin`, not `no-referrer`: that one makes the browser send `Origin: null` on the form post,
// which a Server Action refuses, so the form would fail with scripting off.
export const metadata: Metadata = {
  title: reviewCopy.pageTitle,
  description: null,
  robots: { index: false, follow: false, nocache: true },
  referrer: 'origin',
  openGraph: null,
  twitter: null,
};

export default async function ReviewPage({
  params,
  searchParams,
}: PageProps<'/review/[reference]/[token]'>) {
  await connection();
  const [{ reference, token }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const [page, draft] = await Promise.all([
    readReviewPage(reference, token),
    readReviewDraft(reference),
  ]);
  const { screen, summary } = reviewView(page, query);
  return (
    <ReviewForm
      screen={screen}
      summary={summary}
      draft={draft}
      reference={reference}
      token={token}
      action={submitReviewForm}
    />
  );
}
