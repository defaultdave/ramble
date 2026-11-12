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
  resendBookingConfirmation: mocks.resendBookingConfirmation,
  voidBookingLinks: mocks.voidBookingLinks,
}));
vi.mock('@/server/db/orderRefundRetry', () => ({
  retryFailedRefund: mocks.retryFailedRefund,
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
// - a form without a booking id goes back to the list and writes nothing
// - a cancel or refund without the amount shown goes back to the booking with the invalid notice and writes nothing; a resend without its id goes back to the booking
// - each action sends ops back to the booking with the notice for what the data layer answered
// - the booking, the amount shown or the resend id, and the ops caller reach the data layer as parsed

const id = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const resendId = '2f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const ops = { userId: 'u', roles: ['ops'], hostIds: [] };
const back = (notice: string) => `/ops/bookings/${id}?notice=${notice}`;

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const table = [
  [
    'cancelBookingAction',
    cancelBookingAction,
    mocks.cancelBookingAsOps,
    { orderId: id, expectedRefundMinor: '10800' },
    { orderId: id, expectedRefundMinor: 10800 },
    { status: 'terms_changed', refundMinor: 0 },
    'terms_changed',
  ],
  [
    'refundBookingAction',
    refundBookingAction,
    mocks.refundBookingAsOps,
    { orderId: id, expectedRefundMinor: '13000' },
    { orderId: id, expectedRefundMinor: 13000 },
    'requested',
    'refund_requested',
  ],
  [
    'retryRefundAction',
    retryRefundAction,
    mocks.retryFailedRefund,
    { orderId: id },
    id,
    'refused',
    'refund_refused',
  ],
  [
    'resendConfirmationAction',
    resendConfirmationAction,
    mocks.resendBookingConfirmation,
    { orderId: id, resendId },
    { orderId: id, resendId },
    'queued',
    'resent',
  ],
  [
    'voidLinksAction',
    voidLinksAction,
    mocks.voidBookingLinks,
    { orderId: id },
    id,
    { version: 2 },
    'links_voided',
  ],
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.opsCallerOrLeave.mockResolvedValue(ops);
});

describe.each(table)(
  '%s',
  (_name, action, write, fields, passed, answer, notice) => {
    it('leaves before reading the form when the caller is not ops', async () => {
      mocks.opsCallerOrLeave.mockRejectedValue(new Redirected('/ops/bookings'));
      await expect(action(form(fields))).rejects.toMatchObject({
        href: '/ops/bookings',
      });
      expect(write).not.toHaveBeenCalled();
    });

    it('goes back to the list for a form with no booking', async () => {
      const rest = Object.fromEntries(
        Object.entries(fields).filter(([name]) => name !== 'orderId'),
      );
      await expect(action(form(rest))).rejects.toMatchObject({
        href: '/ops/bookings',
      });
      expect(write).not.toHaveBeenCalled();
    });

    it('writes for the booking and goes back to it with the notice', async () => {
      write.mockResolvedValue(answer);
      await expect(action(form(fields))).rejects.toMatchObject({
        href: back(notice),
      });
      expect(write).toHaveBeenCalledWith(ops, passed);
    });
  },
);

describe.each([
  ['cancelBookingAction', cancelBookingAction, mocks.cancelBookingAsOps],
  ['refundBookingAction', refundBookingAction, mocks.refundBookingAsOps],
])('%s without the amount shown', (_name, action, write) => {
  it.each([
    ['no amount', { orderId: id }],
    [
      'an amount that is not digits',
      { orderId: id, expectedRefundMinor: '1.5' },
    ],
  ])(
    'goes back to the booking with the invalid notice for %s',
    async (_case, fields) => {
      await expect(action(form(fields))).rejects.toMatchObject({
        href: back('invalid'),
      });
      expect(write).not.toHaveBeenCalled();
    },
  );
});

describe('resendConfirmationAction without its id', () => {
  it('goes back to the booking and queues nothing', async () => {
    await expect(
      resendConfirmationAction(form({ orderId: id })),
    ).rejects.toMatchObject({ href: `/ops/bookings/${id}` });
    expect(mocks.resendBookingConfirmation).not.toHaveBeenCalled();
  });
});

describe('cancelBookingAction when the links changed under it', () => {
  it('says to reload and try again', async () => {
    mocks.cancelBookingAsOps.mockResolvedValue({ status: 'try_again' });
    await expect(
      cancelBookingAction(form({ orderId: id, expectedRefundMinor: '0' })),
    ).rejects.toMatchObject({ href: back('try_again') });
  });
});
