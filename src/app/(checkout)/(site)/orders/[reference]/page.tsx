import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { OrderConfirmation } from '@/components/OrderConfirmation';
import { orderAccessCookieName, pickOrderToken } from '@/lib/orderAccess';
import { orderTokenParam } from '@/lib/routes';
import { getOrderStatus } from '@/server/actions/orders';
import { readOrderPage } from '@/server/orderConfirmation';

// The address is a capability, so nothing here may describe the order: a generic title, no
// description, and no Open Graph or Twitter card, so a pasted link unfurls to nothing.
export const metadata: Metadata = {
  title: 'Order confirmation',
  description: null,
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
  openGraph: null,
  twitter: null,
};

export default async function OrderConfirmationPage({
  params,
  searchParams,
}: PageProps<'/orders/[reference]'>) {
  const [{ reference }, query, jar] = await Promise.all([
    params,
    searchParams,
    cookies(),
  ]);
  const token = pickOrderToken({
    cookie: jar.get(orderAccessCookieName)?.value,
    query: query[orderTokenParam],
  });
  const view = token === null ? null : await readOrderPage(reference, token);
  if (token === null || view === null) notFound();
  return (
    <OrderConfirmation view={view} token={token} checkStatus={getOrderStatus} />
  );
}
