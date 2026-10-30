import { Alert } from '@/components/Alert';
import { ButtonLink } from '@/components/Button';
import { demoOrderPath, demoSummary } from '@/lib/demoCheckout';
import { DemoOrderSummary } from './DemoOrderSummary';
import { DemoPage } from './DemoPage';

// TODO(U-041): remove the demo click-through once the booking bar creates real holds.
export function DemoCheckout() {
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
