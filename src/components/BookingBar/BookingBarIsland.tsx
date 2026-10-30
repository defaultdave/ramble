'use client';

import { BookingBar } from '@/components/BookingBar';
import { useBookingDraft } from '@/components/BookingChoices/useBookingDraft';
import { barView, type BookingOffer } from '@/lib/bookingDraft';

/** The booking bar on a phone: what is chosen so far, and the one thing to press next. */
export function BookingBarIsland({ offer }: { offer: BookingOffer }) {
  const { state, handlers, submit } = useBookingDraft(offer);
  const bar = barView(offer, state);
  switch (bar.state) {
    case 'paused':
      return <BookingBar state="paused" />;
    case 'sold-out':
      return <BookingBar state="sold-out" similarHref={offer.similarHref} />;
    case 'date-chosen':
      return (
        <BookingBar
          state="date-chosen"
          when={bar.when}
          guests={bar.guests}
          totalMinor={bar.totalMinor}
          loading={state.pending}
          onContinue={() => void submit()}
        />
      );
    case 'default':
      return (
        <BookingBar
          priceMinor={bar.priceMinor}
          {...(bar.nextDate ? { nextDate: bar.nextDate } : {})}
          onChooseDate={handlers.onOpen}
        />
      );
  }
}
