import type { Metadata } from 'next';
import { connection } from 'next/server';
import { ReviewForm } from '@/components/ReviewForm';
import { reviewScreen } from '@/lib/reviews';
import { submitReviewForm } from '@/server/actions/reviews';
import { readReviewPage } from '@/server/reviewForm';

// The address is a capability, so nothing here may describe the booking: a generic title, no
// description, and no Open Graph or Twitter card, so a pasted link unfurls to nothing.
export const metadata: Metadata = {
  title: 'Review your booking',
  description: null,
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
  openGraph: null,
  twitter: null,
};

export default async function ReviewPage({
  params,
  searchParams,
}: PageProps<'/review/[reference]/[token]'>) {
  await connection();
  const [{ reference, token }, query] = await Promise.all([params, searchParams]);
  const page = await readReviewPage(reference, token);
  const screen = reviewScreen(page.read, page.now, query);
  return (
    <ReviewForm
      screen={screen}
      summary={screen.kind === 'invalid' ? null : page.summary}
      reference={reference}
      token={token}
      action={submitReviewForm}
    />
  );
}
