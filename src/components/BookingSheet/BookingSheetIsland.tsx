'use client';

import { BookingSheet } from '@/components/BookingSheet';
import {
  BookingChoices,
  BookingFooter,
  BookingModeSwitch,
  BookingPausedNotice,
} from '@/components/BookingChoices';
import { useBookingDraft } from '@/components/BookingChoices/useBookingDraft';
import {
  canContinue,
  choicesView,
  type BookingOffer,
} from '@/lib/bookingDraft';
import styles from './BookingSheetIsland.module.css';

/** The booking sheet a phone opens from the bar: the choices, and Continue, which places the hold. */
export function BookingSheetIsland({ offer }: { offer: BookingOffer }) {
  const { state, handlers, submit } = useBookingDraft(offer);
  const view = choicesView(offer, state);
  return (
    <BookingSheet
      open={state.sheetOpen}
      onClose={handlers.onClose}
      title={offer.title}
      footer={
        state.paused ? undefined : (
          <BookingFooter
            summary={view.summary}
            canContinue={canContinue(offer, state)}
            pending={state.pending}
            onContinue={() => void submit()}
          />
        )
      }
    >
      {state.paused ? (
        <BookingPausedNotice />
      ) : (
        <div className={styles.content}>
          {view.showModeSwitch ? (
            <div className={styles.mode}>
              <BookingModeSwitch mode={view.mode} onMode={handlers.onMode} />
            </div>
          ) : null}
          <BookingChoices
            view={view}
            similarHref={offer.similarHref}
            {...handlers}
          />
        </div>
      )}
    </BookingSheet>
  );
}
