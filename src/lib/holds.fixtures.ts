import type { HoldTimes } from './holds';

export const at = new Date('2026-11-01T12:00:00.000Z');
export const later = (ms: number) => new Date(at.getTime() + ms);
export const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
export const otherUuid = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

export const booking = {
  sessionId: uuid,
  items: [{ priceOptionId: otherUuid, quantity: 2 }],
  purpose: 'booking' as const,
};

export const active = (expiresAt: Date): HoldTimes => ({
  status: 'active',
  expiresAt,
  payingUntil: null,
});

export const minuteMs = 60_000;
export const deviceKey = 'a'.repeat(64);
export const open = (overrides = {}) => ({
  id: 'h1',
  deviceKey,
  status: 'active' as const,
  expiresAt: later(minuteMs),
  payingUntil: null,
  ...overrides,
});
