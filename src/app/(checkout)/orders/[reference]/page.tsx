import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { OrderConfirmation } from '@/components/OrderConfirmation';
import { demoOrderPath } from '@/lib/demoCheckout';
import { orderAccessCookieName, pickOrderToken } from '@/lib/orderAccess';
import { orderPath, orderTokenParam } from '@/lib/routes';
import { getOrderStatus } from '@/server/actions/orders';
import { readOrderPage } from '@/server/orderConfirmation';
import { DemoConfirmation } from './DemoConfirmation';

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
  // TODO(U-047b): the demo checkout ends here until the real one does.
  if (orderPath(reference) === demoOrderPath) return <DemoConfirmation />;

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
