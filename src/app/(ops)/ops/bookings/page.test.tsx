import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readOpsCaller: vi.fn(),
  readOpsBookings: vi.fn(),
  readOpsBooking: vi.fn(),
}));

vi.mock('@/server/opsCaller', () => ({ readOpsCaller: mocks.readOpsCaller }));
vi.mock('@/server/db/opsBookings', () => ({
  readOpsBookings: mocks.readOpsBookings,
  readOpsBooking: mocks.readOpsBooking,
}));

import { OpsAccessDenied } from '@/components/OpsShell';
import BookingPage from './[id]/page';
import BookingsPage from './page';

// Behaviours under test:
// - a caller without the ops role (a guest, an admin, nobody) gets the access-denied view and nothing is read, on the list and on a booking
// - an ops caller reads the list with the search, filter, and cursor the address names
// - an ops caller opening a booking that is not there, or an address that is not an id, gets not-found

const ops = { userId: 'u', roles: ['ops'], hostIds: [] };
const cursor = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const params = Promise.resolve({});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readOpsBookings.mockResolvedValue({ rows: [], nextCursor: null });
});

describe.each([
  ['a guest', { userId: 'g', roles: ['guest'], hostIds: [] }],
  ['an admin', { userId: 'a', roles: ['admin'], hostIds: [] }],
  ['nobody', { userId: null, roles: [], hostIds: [] }],
])('for %s', (_who, caller) => {
  it('shows the access-denied view and reads nothing', async () => {
    mocks.readOpsCaller.mockResolvedValue(caller);
    const list = await BookingsPage({
      params,
      searchParams: Promise.resolve({}),
    });
    const booking = await BookingPage({
      params: Promise.resolve({ id: cursor }),
      searchParams: Promise.resolve({}),
    });
    expect(isValidElement(list) && list.type).toBe(OpsAccessDenied);
    expect(isValidElement(booking) && booking.type).toBe(OpsAccessDenied);
    expect(mocks.readOpsBookings).not.toHaveBeenCalled();
    expect(mocks.readOpsBooking).not.toHaveBeenCalled();
  });
});

describe('the bookings list', () => {
  it('reads by the search, filter, and cursor in the address', async () => {
    mocks.readOpsCaller.mockResolvedValue(ops);
    await BookingsPage({
      params,
      searchParams: Promise.resolve({
        q: 'Pat@Example.com',
        status: 'refund_failed',
        cursor,
      }),
    });
    expect(mocks.readOpsBookings).toHaveBeenCalledWith(ops, {
      search: { kind: 'email', email: 'pat@example.com' },
      filter: 'refund_failed',
      cursor,
    });
  });
});

describe('a booking page', () => {
  it.each([
    ['an address that is not an id', 'nope', 0],
    ['a booking that is not there', cursor, 1],
  ])('is not found for %s', async (_name, id, reads) => {
    mocks.readOpsCaller.mockResolvedValue(ops);
    mocks.readOpsBooking.mockResolvedValue(null);
    await expect(
      BookingPage({
        params: Promise.resolve({ id }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    });
    expect(mocks.readOpsBooking).toHaveBeenCalledTimes(reads);
  });
});
