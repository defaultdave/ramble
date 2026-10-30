import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Alert } from '@/components/Alert';
import { ButtonLink } from '@/components/Button';
import { CheckoutPage } from '@/components/CheckoutPage';
import { CheckoutFrame } from '@/components/CheckoutPage/CheckoutFrame';
import { EntityIdSchema } from '@/lib/catalog';
import { checkoutPath } from '@/lib/routes';
import { notFoundPerRequest } from '@/app/renderPerRequest';
import { readCheckoutView } from '@/server/db/checkoutView';
import { readDevice } from '@/server/device';
import { startPayment } from '@/server/actions/checkout';
import { confirmFakePayment } from '@/server/actions/fakePayment';
import { reholdSpaces } from '@/server/actions/rehold';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { getCachedGuestSettings } from '@/server/siteSettings';

export const metadata: Metadata = { title: 'Checkout' };

export default async function CheckoutRoute({
  params,
  searchParams,
}: PageProps<'/checkout/[holdId]'>) {
  const parsed = EntityIdSchema.safeParse((await params).holdId);
  // A malformed id is no hold, and no query is made for it.
  if (!parsed.success) return notFoundPerRequest();
  const holdId = parsed.data.toLowerCase();

  // Reading the cookie never sets one: a guest with no device has no hold.
  const device = await readDevice();
  if (!device) notFound();

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
      <CheckoutFrame>
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
      </CheckoutFrame>
    );
  }

  if (!read) notFound();
  return (
    <CheckoutFrame>
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
    </CheckoutFrame>
  );
}
