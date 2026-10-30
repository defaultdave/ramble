'use client';

import { BookingPanel } from '@/components/BookingPanel';
import { BookingChoices, BookingModeSwitch } from '@/components/BookingChoices';
import { useBookingDraft } from '@/components/BookingChoices/useBookingDraft';
import { holdNote } from '@/lib/booking';
import {
  barView,
  canContinue,
  choicesView,
  lowestPriceMinor,
  type BookingOffer,
} from '@/lib/bookingDraft';

/** The booking panel beside the page on a wide screen: the same choices as the sheet, in place, with Continue under them. */
export function BookingPanelIsland({ offer }: { offer: BookingOffer }) {
  const { state, handlers, submit } = useBookingDraft(offer);
  const priceMinor = lowestPriceMinor(offer);
  const bar = barView(offer, state);
  if (bar.state === 'paused') {
    return <BookingPanel state="paused" priceMinor={priceMinor} />;
  }
  if (bar.state === 'sold-out') {
    return (
      <BookingPanel
        state="sold-out"
        priceMinor={priceMinor}
        similarHref={offer.similarHref}
        privateSessionHref={offer.privateSessionHref}
      />
    );
  }
  const view = choicesView(offer, state);
  const { summary } = view;
  return (
    <BookingPanel
      priceMinor={priceMinor}
      {...(view.showModeSwitch
        ? {
            mode: (
              <BookingModeSwitch mode={view.mode} onMode={handlers.onMode} />
            ),
          }
        : {})}
      {...(summary && canContinue(offer, state)
        ? {
            total: {
              label: summary.label,
              amountMinor: summary.totalMinor,
              ...(summary.terms ? { terms: summary.terms } : {}),
            },
          }
        : {})}
      holdNote={holdNote}
      loading={state.pending}
      onContinue={() => void submit('panel')}
    >
      <BookingChoices
        view={view}
        similarHref={offer.similarHref}
        {...handlers}
      />
    </BookingPanel>
  );
}
