import { Alert } from '@/components/Alert';
import { ButtonLink } from '@/components/Button';
import { demoSummary } from '@/lib/demoCheckout';
import { browsePath } from '@/lib/routes';
import { DemoOrderSummary } from '../../_demo/DemoOrderSummary';
import { DemoPage } from '../../_demo/DemoPage';

// TODO(U-047b): goes with the demo checkout, which this is the end of.
export function DemoConfirmation() {
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
