import { type HoldTimes } from './holds';
import { testIds } from './testIds';

export const uuid = testIds.hold;
export const otherUuid = testIds.terms;

export const active = (expiresAt: Date): HoldTimes => ({
  status: 'active',
  expiresAt,
  payingUntil: null,
});

export const minuteMs = 60_000;
