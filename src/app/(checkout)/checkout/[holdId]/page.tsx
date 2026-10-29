import type { Metadata } from 'next';
import { Alert } from '@/components/Alert';
import { ButtonLink } from '@/components/Button';
import { demoOrderPath, demoSummary } from '@/lib/demoCheckout';
import { DemoOrderSummary } from '../../_demo/DemoOrderSummary';
import { DemoPage } from '../../_demo/DemoPage';

export const metadata: Metadata = { title: 'Checkout' };

// TODO(U-047b): replaced by the checkout page.
export default function CheckoutPage() {
  return (
    <DemoPage title="Checkout">
      <Alert
        tone="info"
        title="This is a demo checkout"
        body="No payment is taken and nothing is booked."
      />
      <DemoOrderSummary summary={demoSummary} />
      <ButtonLink href={demoOrderPath} variant="primary" size="lg">
        Pay (demo)
      </ButtonLink>
    </DemoPage>
  );
}
