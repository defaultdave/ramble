'use client';

import { Header } from '@/components/Header';
import { ErrorNotice } from '@/components/ErrorNotice';

/**
 * The checkout page's error state. The skip link and footer come from the layout beside it; the
 * header is the checkout one without a timer, since a page that failed has no hold to count down.
 */
export default function CheckoutError({ retry }: { retry: () => void }) {
  return (
    <>
      <Header variant="checkout" holdTimer={null} />
      <main id="main">
        <ErrorNotice onRetry={retry} />
      </main>
    </>
  );
}
