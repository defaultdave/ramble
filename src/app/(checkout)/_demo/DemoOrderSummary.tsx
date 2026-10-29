'use client';

import { useState } from 'react';
import { OrderSummary } from '@/components/OrderSummary';
import type { DemoSummary } from '@/lib/demoCheckout';

// TODO(U-047b): replaced by the checkout page, which owns the summary's expanded state.
const demoMeta = {
  dateLabel: 'Sat, Nov 14',
  timeLabel: '2:00 PM',
  where: 'Demo order. The real meeting point arrives with the booking.',
  terms: 'Demo order. Nothing is charged and nothing is booked.',
};

/** The summary needs a click handler, which a page cannot pass, so the page hands this the plain data. */
export function DemoOrderSummary({ summary }: { summary: DemoSummary }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <OrderSummary
      title={summary.title}
      guests={summary.guests}
      lines={summary.lines}
      totalMinor={summary.totalMinor}
      taxTreatment="not_taxable"
      taxMinor={0}
      expanded={expanded}
      onToggle={() => {
        setExpanded((open) => !open);
      }}
      {...demoMeta}
    />
  );
}
