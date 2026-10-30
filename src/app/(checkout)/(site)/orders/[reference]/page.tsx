import type { Metadata } from 'next';
import { Alert } from '@/components/Alert';
import { ButtonLink } from '@/components/Button';
import { demoSummary } from '@/lib/demoCheckout';
import { browsePath } from '@/lib/routes';
import { DemoOrderSummary } from '../../../_demo/DemoOrderSummary';
import { DemoPage } from '../../../_demo/DemoPage';

export const metadata: Metadata = { title: 'Order confirmation' };

// TODO(U-050): replaced by the confirmation page.
export default function OrderConfirmationPage() {
  return (
    <DemoPage title="Order confirmation">
      <Alert
        tone="success"
        title="Your demo order is confirmed"
        body="This was a demo: nothing was charged and nothing was booked."
      />
      <DemoOrderSummary summary={demoSummary} />
      <ButtonLink href={browsePath} variant="secondary">
        Browse more experiences
      </ButtonLink>
    </DemoPage>
  );
}
