import type { BookingEmailSource } from './bookingEmails';

// Two fixture orders for the booking emails' tests and for the evidence renders: a taxable booking
// for two adults and a child, and a gift-paid, untaxed booking for one with no meeting point.

export const appUrl = 'https://ramble.example';

/** A capability token has 43 characters of base64url; this one is obviously not a real one. */
export const fakeManageToken = 'fixture-manage-token-not-a-secret_012345678';

export const orderA: BookingEmailSource = {
  orderId: '0f6c9a52-3b8e-4f43-9a55-1a2b3c4d5e01',
  reference: 'RMB-A3K7MN',
  kind: 'booking',
  status: 'confirmed',
  leadGuestName: 'Pat Rivera',
  experienceName: 'Sunset sail on the Hudson',
  meetingPoint: 'Pier 40, West Side Highway at Houston Street',
  durationMinutes: 120,
  hostName: 'Harbor Light Sailing',
  startsAt: new Date('2026-11-07T21:00:00Z'),
  endsAt: new Date('2026-11-07T23:00:00Z'),
  timeZone: 'America/New_York',
  items: [
    { label: 'Adult', quantity: 2, lineTotalMinor: 17000, usesSpace: true },
    { label: 'Child', quantity: 1, lineTotalMinor: 4500, usesSpace: true },
  ],
  taxTreatment: 'taxable',
  taxMinor: 1912,
  totalMinor: 23412,
  giftAppliedMinor: 0,
  amountDueMinor: 23412,
  freeCancelUntil: new Date('2026-11-06T21:00:00Z'),
  confirmedAt: new Date('2026-10-29T15:30:00Z'),
};

export const orderB: BookingEmailSource = {
  orderId: '7d1e2f30-4a5b-4c6d-8e7f-9a0b1c2d3e02',
  reference: 'RMB-9TWX2C',
  kind: 'booking',
  status: 'confirmed',
  leadGuestName: null,
  experienceName: 'Pottery wheel night',
  meetingPoint: null,
  durationMinutes: null,
  hostName: 'Clay & Co',
  startsAt: new Date('2026-12-02T23:30:00Z'),
  endsAt: new Date('2026-12-03T01:30:00Z'),
  timeZone: 'America/New_York',
  items: [
    { label: 'Adult', quantity: 1, lineTotalMinor: 9500, usesSpace: true },
  ],
  taxTreatment: 'not_taxable',
  taxMinor: 0,
  totalMinor: 9500,
  giftAppliedMinor: 4000,
  amountDueMinor: 5500,
  freeCancelUntil: null,
  confirmedAt: new Date('2026-10-29T16:00:00Z'),
};
