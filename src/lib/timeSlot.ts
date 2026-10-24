import { spacesStatus } from './spaces';

export type TimeSlotState = 'open' | 'few-left' | 'sold-out' | 'selected';

// A slot that sold out while chosen reads as sold out: the guest cannot book it.
export function timeSlotState(
  spacesLeft: number,
  selected: boolean,
): TimeSlotState {
  const status = spacesStatus(spacesLeft);
  if (status === 'sold-out') return 'sold-out';
  return selected ? 'selected' : status;
}
