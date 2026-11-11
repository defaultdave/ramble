import type { BookingEmailSource } from './bookingEmails';
import type { CancelFacts } from './cancelBooking';
import {
  manageReadOutcome,
  type ManageView,
  type MovePickerRead,
} from './manageBooking';

/** The page for a booking found at `now`, read the way the route reads it; a fixture that is not a booking is a mistake in the test. */
export function manageViewOf(
  source: BookingEmailSource,
  facts: CancelFacts,
  now: Date,
  picker: MovePickerRead | null = null,
): ManageView {
  const outcome = manageReadOutcome({ order: source, facts, now, picker });
  if (outcome.kind !== 'ok') throw new Error('The fixture is not a booking');
  return outcome.view;
}
