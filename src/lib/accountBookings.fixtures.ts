import { id } from '../../tests/support/ids';
import type { AccountBookingData } from './accountBookings';

/** A confirmed booking as the data layer reads it; booking `n` has its own id and reference. */
export const accountBookingData = (
  n: number,
  startsAt: string,
  manageTokenVersion = 1,
  overrides: Partial<AccountBookingData> = {},
): AccountBookingData => ({
  id: id(n),
  reference: `RMB-00000${String(n)}`,
  experienceName: 'Sunset kayak',
  sessionStartsAt: new Date(startsAt),
  timeZone: 'America/New_York',
  status: 'confirmed',
  manageTokenVersion,
  ...overrides,
});
