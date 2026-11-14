import type { ImpactOrder } from './opsSessions';

// What the ops session tests share: ids, times, and an order and a hold to change.

export const sessionId = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
export const userId = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
export const now = new Date('2026-11-10T12:00:00Z');
export const tomorrow = new Date('2026-11-11T15:00:00Z');
export const yesterday = new Date('2026-11-09T15:00:00Z');
export const paid = [{ status: 'succeeded', providerPaymentId: 'pay_1' }];

export const order = (over: Partial<ImpactOrder> = {}): ImpactOrder => ({
  reference: 'RMB-0001',
  status: 'confirmed',
  ticketSubtotalMinor: 10000,
  taxMinor: 800,
  totalMinor: 10800,
  amountDueMinor: 10800,
  commissionMinor: 1500,
  commissionRateBps: 1500,
  refundedTicketMinor: 0,
  refundedTaxMinor: 0,
  commissionReturnedMinor: 0,
  attempts: paid,
  ...over,
});

export const hold = (over: Record<string, unknown> = {}) => ({
  sessionId,
  status: 'active' as const,
  seats: 2,
  expiresAt: new Date(now.getTime() + 60_000),
  payingUntil: null,
  ...over,
});

export const form = (fields: Record<string, unknown>) => (name: string) =>
  fields[name] ?? null;
