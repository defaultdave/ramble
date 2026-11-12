import {
  buildOpsSessionRows,
  buildOpsSessionView,
  impactView,
  sessionImpact,
  type ImpactOrder,
} from '@/lib/opsSessions';

const now = new Date('2026-11-10T12:00:00Z');

const order = (
  reference: string,
  over: Partial<ImpactOrder> = {},
): ImpactOrder => ({
  reference,
  status: 'confirmed',
  ticketSubtotalMinor: 17000,
  taxMinor: 1360,
  totalMinor: 18360,
  amountDueMinor: 18360,
  commissionMinor: 2550,
  commissionRateBps: 1500,
  refundedTicketMinor: 0,
  refundedTaxMinor: 0,
  commissionReturnedMinor: 0,
  attempts: [{ status: 'succeeded', providerPaymentId: 'pay_1' }],
  ...over,
});

export const sessionRows = buildOpsSessionRows([
  {
    id: '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    experienceName: 'Harbor sunrise kayak',
    hostName: 'Tidewater Outfitters',
    startsAt: new Date('2026-11-14T11:00:00Z'),
    timeZone: 'America/New_York',
    allocation: 12,
    seatsSold: 5,
    heldSeats: 2,
    status: 'scheduled',
  },
  {
    id: '1a1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
    experienceName: 'Old town food walk',
    hostName: 'Walk and Taste',
    startsAt: new Date('2026-11-02T16:00:00Z'),
    timeZone: 'America/New_York',
    allocation: 8,
    seatsSold: 8,
    heldSeats: 0,
    status: 'completed',
  },
]);

const sessionRecord = {
  id: '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  experienceId: '9f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b',
  experienceName: 'Harbor sunrise kayak',
  hostName: 'Tidewater Outfitters',
  startsAt: new Date('2026-11-14T11:00:00Z'),
  timeZone: 'America/New_York',
  allocation: 12,
  seatsSold: 5,
  heldSeats: 2,
  status: 'scheduled',
} as const;

const heldSeat = {
  status: 'active',
  seats: 2,
  expiresAt: new Date('2026-11-10T12:10:00Z'),
  payingUntil: null,
} as const;

const booked = sessionImpact(
  [order('RMB-4F7K2Q'), order('RMB-9TT3XM')],
  [heldSeat],
  now,
);
const blocked = sessionImpact(
  [
    order('RMB-4F7K2Q'),
    order('RMB-9TT3XM', { amountDueMinor: 17000 }),
    order('RMB-2B8C5D', { attempts: [] }),
  ],
  [],
  now,
);
const empty = sessionImpact([], [], now);

export const bookedImpact = impactView(booked);
export const emptyImpact = impactView(empty);
export const blockedImpact = impactView(blocked);

export const openSession = buildOpsSessionView(sessionRecord, now, booked);
export const cancelledSession = buildOpsSessionView(
  { ...sessionRecord, status: 'cancelled' },
  now,
  empty,
);
export const blockedSession = buildOpsSessionView(sessionRecord, now, blocked);
