import type { Metadata } from 'next';
import { Alert } from '@/components/Alert';
import { ButtonLink } from '@/components/Button';
import { CheckoutPage } from '@/components/CheckoutPage';
import { Header } from '@/components/Header';
import { NotFoundNotice } from '@/components/NotFoundNotice';
import { EntityIdSchema } from '@/lib/catalog';
import { checkoutPath } from '@/lib/routes';
import { readCheckoutView } from '@/server/db/checkoutView';
import { readDevice } from '@/server/device';
import { startPayment } from '@/server/actions/checkout';
import { confirmFakePayment } from '@/server/actions/fakePayment';
import { reholdSpaces } from '@/server/actions/rehold';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { getCachedGuestSettings } from '@/server/siteSettings';

export const metadata: Metadata = { title: 'Checkout' };

/**
 * Rendered, not thrown with `notFound()`: a thrown not-found leaves the first flush an empty shell
 * that the browser must fill by running script, with no heading and no stylesheet link.
 */
function HoldNotFound() {
  return (
    <>
      <Header variant="checkout" holdTimer={null} />
      <main id="main">
        <NotFoundNotice />
      </main>
    </>
  );
}

export default async function CheckoutRoute({
  params,
  searchParams,
}: PageProps<'/checkout/[holdId]'>) {
  const parsed = EntityIdSchema.safeParse((await params).holdId);
  // A malformed id is no hold, and no query is made for it.
  if (!parsed.success) return <HoldNotFound />;
  const holdId = parsed.data.toLowerCase();

  // Reading the cookie never sets one: a guest with no device has no hold.
  const device = await readDevice();
  if (!device) return <HoldNotFound />;

  let read;
  let maintenance;
  try {
    [read, { checkoutMaintenance: maintenance }] = await Promise.all([
      readCheckoutView(device, holdId),
      getCachedGuestSettings(),
    ]);
  } catch (error) {
    rethrowOrLog('The checkout page could not be read', error);
    return (
      <main id="main">
        <h1>Checkout</h1>
        <Alert
          tone="danger"
          title="We couldn't load checkout"
          body="Something went wrong on our side. Your spaces stay held until the timer ends. Try again in a moment."
        />
        <ButtonLink href={checkoutPath(holdId)} variant="secondary">
          Try again
        </ButtonLink>
      </main>
    );
  }

  if (!read) return <HoldNotFound />;
  return (
    <CheckoutPage
      view={read.view}
      maintenance={maintenance}
      focusTitle={(await searchParams).rehold === '1'}
      actions={{
        startPayment,
        confirm: confirmFakePayment,
        reserve: reholdSpaces,
      }}
    />
  );
}
