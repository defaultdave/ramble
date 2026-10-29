'use client';

import { useState } from 'react';
import { OrderSummary } from '@/components/OrderSummary';
import type { DemoSummary } from '@/lib/demoCheckout';

// TODO(U-047b): replaced by the checkout page, which owns the summary's expanded state.
/** The summary needs a click handler, which a page cannot pass, so the page hands this the plain data. */
export function DemoOrderSummary({ summary }: { summary: DemoSummary }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <OrderSummary
      {...summary}
      expanded={expanded}
      onToggle={() => {
        setExpanded((open) => !open);
      }}
    />
  );
}
