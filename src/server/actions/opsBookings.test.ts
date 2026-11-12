import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  opsCallerOrLeave: vi.fn(),
  cancelBookingAsOps: vi.fn(),
  refundBookingAsOps: vi.fn(),
  retryFailedRefund: vi.fn(),
  voidBookingLinks: vi.fn(),
  resendBookingConfirmation: vi.fn(),
}));

class Redirected extends Error {
  constructor(readonly href: string) {
    super(href);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Redirected(href);
  },
}));
vi.mock('@/server/opsAccess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/opsAccess')>()),
  opsCallerOrLeave: mocks.opsCallerOrLeave,
}));
vi.mock('@/server/db/opsBookings', () => ({
  cancelBookingAsOps: mocks.cancelBookingAsOps,
  refundBookingAsOps: mocks.refundBookingAsOps,
  voidBookingLinks: mocks.voidBookingLinks,
}));
vi.mock('@/server/db/orderRefundRetry', () => ({
  retryFailedRefund: mocks.retryFailedRefund,
}));
vi.mock('@/server/opsBookingResend', () => ({
  resendBookingConfirmation: mocks.resendBookingConfirmation,
}));

import {
  cancelBookingAction,
  refundBookingAction,
  resendConfirmationAction,
  retryRefundAction,
  voidLinksAction,
} from './opsBookings';

// Behaviours under test:
// - the caller is checked first: a caller sent away reads the form and writes nothing
// - a form without a booking id goes back to the list and writes nothing; a cancel without the refund shown goes back to the booking with the invalid notice and cancels nothing
// - each action sends ops back to the booking with the notice for what the data layer answered
// - the booking and the ops caller reach the data layer as parsed

const id = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const ops = { userId: 'u', roles: ['ops'], hostIds: [] };
const back = (notice: string) => `/ops/bookings/${id}?notice=${notice}`;

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const simple = [
  [
    'refundBookingAction',
    refundBookingAction,
    mocks.refundBookingAsOps,
    'requested',
    'refund_requested',
  ],
  [
    'retryRefundAction',
    retryRefundAction,
    mocks.retryFailedRefund,
    'refused',
    'refund_refused',
  ],
  [
    'resendConfirmationAction',
    resendConfirmationAction,
    mocks.resendBookingConfirmation,
    'sent',
    'resent',
  ],
  [
    'voidLinksAction',
    voidLinksAction,
    mocks.voidBookingLinks,
    { version: 2 },
    'links_voided',
  ],
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.opsCallerOrLeave.mockResolvedValue(ops);
});

describe.each(simple)('%s', (_name, action, write, answer, notice) => {
  it('leaves before reading the form when the caller is not ops', async () => {
    mocks.opsCallerOrLeave.mockRejectedValue(new Redirected('/ops/bookings'));
    await expect(action(form({ orderId: id }))).rejects.toMatchObject({
      href: '/ops/bookings',
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('goes back to the list for a form with no booking', async () => {
    await expect(action(form({}))).rejects.toMatchObject({
      href: '/ops/bookings',
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('writes for the booking and goes back to it with the notice', async () => {
    write.mockResolvedValue(answer);
    await expect(action(form({ orderId: id }))).rejects.toMatchObject({
      href: back(notice),
    });
    expect(write).toHaveBeenCalledWith(ops, id);
  });
});

describe('cancelBookingAction', () => {
  it('leaves before reading the form when the caller is not ops', async () => {
    mocks.opsCallerOrLeave.mockRejectedValue(new Redirected('/ops/bookings'));
    await expect(
      cancelBookingAction(form({ orderId: id, expectedRefundMinor: '0' })),
    ).rejects.toMatchObject({ href: '/ops/bookings' });
    expect(mocks.cancelBookingAsOps).not.toHaveBeenCalled();
  });

  it.each([
    ['no refund shown', { orderId: id }],
    [
      'a refund that is not digits',
      { orderId: id, expectedRefundMinor: '1.5' },
    ],
  ])(
    'goes back to the booking with the invalid notice for %s',
    async (_name, fields) => {
      await expect(cancelBookingAction(form(fields))).rejects.toMatchObject({
        href: back('invalid'),
      });
      expect(mocks.cancelBookingAsOps).not.toHaveBeenCalled();
    },
  );

  it('goes back to the list for a cancel with no booking', async () => {
    await expect(
      cancelBookingAction(form({ expectedRefundMinor: '0' })),
    ).rejects.toMatchObject({ href: '/ops/bookings' });
    expect(mocks.cancelBookingAsOps).not.toHaveBeenCalled();
  });

  it('cancels with the refund shown and goes back with the notice for the answer', async () => {
    mocks.cancelBookingAsOps.mockResolvedValue({
      status: 'terms_changed',
      refundMinor: 0,
    });
    await expect(
      cancelBookingAction(form({ orderId: id, expectedRefundMinor: '10800' })),
    ).rejects.toMatchObject({ href: back('terms_changed') });
    expect(mocks.cancelBookingAsOps).toHaveBeenCalledWith(ops, {
      orderId: id,
      expectedRefundMinor: 10800,
    });
  });
});
