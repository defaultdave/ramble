import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelBooking, cancelBookingForm } from './orders';

const consumeRateLimit = vi.hoisted(() => vi.fn());
const resolveManageToken = vi.hoisted(() => vi.fn());
const cancelBookingOrder = vi.hoisted(() => vi.fn());
vi.mock('@/server/ports/rate-limit', () => ({ consumeRateLimit }));
vi.mock('@/server/tokens', () => ({ resolveManageToken }));
vi.mock('@/server/db/orderCancel', () => ({ cancelBookingOrder }));
const redirect = vi.hoisted(() =>
  vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
);
const notFound = vi.hoisted(() =>
  vi.fn((): never => {
    throw new Error('not-found');
  }),
);
vi.mock('next/navigation', () => ({ redirect, notFound }));
vi.mock('@/server/orderConfirmation', () => ({ readOrderState: vi.fn() }));

// Behaviours under test, one per decision, branch, or risk:
// - a malformed token or refund is not found, and spends no try and opens nothing
// - the token is counted against the manage limit, by the token, before it is looked up
// - a token over the limit is told to wait, and opens nothing
// - a token that opens nothing is not found, and cancels nothing
// - a token that opens an order cancels exactly that order at the version the token opened, with the refund shown
// - the answer of the cancel is returned as it is
// - a failed rate-limit store or a failed lookup throws, so nothing is cancelled
// - the form action reads the two fields, cancels, and sends the guest back to the same page with the answer as a status word
// - a form with no usable token or refund is the not-found page and cancels nothing
// - a form answered by the limit or a dead link still lands on the page, carrying that answer

const token = 'A'.repeat(43);
const resolved = { id: 'order-1', version: 3, kind: 'manage' };
const input = { manageToken: token, expectedRefundMinor: 13_000 };

beforeEach(() => {
  vi.resetAllMocks();
  redirect.mockImplementation((path: string): never => {
    throw new Error(`redirect:${path}`);
  });
  notFound.mockImplementation((): never => {
    throw new Error('not-found');
  });
  consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 29 });
  resolveManageToken.mockResolvedValue(resolved);
  cancelBookingOrder.mockResolvedValue({ status: 'already_cancelled' });
});

describe('cancelBooking', () => {
  it.each([
    ['a malformed token', { ...input, manageToken: 'short' }],
    ['a negative refund', { ...input, expectedRefundMinor: -1 }],
    ['an extra key', { ...input, orderId: 'order-2' }],
    ['no input', undefined],
  ])('answers not found for %s without spending a try', async (_name, bad) => {
    expect(await cancelBooking(bad as never)).toEqual({ status: 'not_found' });
    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(resolveManageToken).not.toHaveBeenCalled();
    expect(cancelBookingOrder).not.toHaveBeenCalled();
  });

  it('counts the try against the manage limit by the token, before the lookup', async () => {
    await cancelBooking(input);

    expect(consumeRateLimit).toHaveBeenCalledWith('manage', token);
    expect(consumeRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      resolveManageToken.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('tells a token over the limit to wait, and opens nothing', async () => {
    consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 90,
    });

    expect(await cancelBooking(input)).toEqual({
      status: 'rate_limited',
      retryAfterSeconds: 90,
    });
    expect(resolveManageToken).not.toHaveBeenCalled();
    expect(cancelBookingOrder).not.toHaveBeenCalled();
  });

  it('answers not found for a token that opens nothing', async () => {
    resolveManageToken.mockResolvedValue(null);

    expect(await cancelBooking(input)).toEqual({ status: 'not_found' });
    expect(resolveManageToken).toHaveBeenCalledWith(token);
    expect(cancelBookingOrder).not.toHaveBeenCalled();
  });

  it('cancels the order the token opened, at its version, with the refund shown', async () => {
    cancelBookingOrder.mockResolvedValue({
      status: 'terms_changed',
      refundMinor: 0,
    });

    expect(await cancelBooking(input)).toEqual({
      status: 'terms_changed',
      refundMinor: 0,
    });
    expect(cancelBookingOrder).toHaveBeenCalledExactlyOnceWith({
      token: resolved,
      expectedRefundMinor: 13_000,
    });
  });

  it('throws when the limit store fails, and cancels nothing', async () => {
    consumeRateLimit.mockRejectedValue(new Error('store down'));

    await expect(cancelBooking(input)).rejects.toThrow('store down');
    expect(cancelBookingOrder).not.toHaveBeenCalled();
  });

  it('throws when the token lookup fails, and cancels nothing', async () => {
    resolveManageToken.mockRejectedValue(new Error('lookup down'));

    await expect(cancelBooking(input)).rejects.toThrow('lookup down');
    expect(cancelBookingOrder).not.toHaveBeenCalled();
  });
});

describe('cancelBookingForm', () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };
  const good = form({ manageToken: token, expectedRefundMinor: '13000' });

  it('cancels with the two fields and sends the guest back with the answer', async () => {
    cancelBookingOrder.mockResolvedValue({
      status: 'cancelled',
      refundMinor: 13_000,
      giftReinstated: false,
      refundEta: null,
    });

    await expect(cancelBookingForm(good)).rejects.toThrow(
      `redirect:/manage/${token}?result=cancelled`,
    );
    expect(cancelBookingOrder).toHaveBeenCalledExactlyOnceWith({
      token: resolved,
      expectedRefundMinor: 13_000,
    });
  });

  it('carries a changed refund back to the page', async () => {
    cancelBookingOrder.mockResolvedValue({
      status: 'terms_changed',
      refundMinor: 0,
    });

    await expect(cancelBookingForm(good)).rejects.toThrow(
      `redirect:/manage/${token}?result=terms_changed`,
    );
  });

  it('carries the limit back to the page', async () => {
    consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 9,
    });

    await expect(cancelBookingForm(good)).rejects.toThrow(
      `redirect:/manage/${token}?result=rate_limited`,
    );
    expect(cancelBookingOrder).not.toHaveBeenCalled();
  });

  it('carries a dead link back to the page', async () => {
    resolveManageToken.mockResolvedValue(null);

    await expect(cancelBookingForm(good)).rejects.toThrow(
      `redirect:/manage/${token}?result=not_found`,
    );
  });

  it.each([
    ['no fields', {}],
    ['a short token', { manageToken: 'short', expectedRefundMinor: '1' }],
    ['no refund', { manageToken: token }],
    ['a refund of letters', { manageToken: token, expectedRefundMinor: 'abc' }],
    ['a negative refund', { manageToken: token, expectedRefundMinor: '-1' }],
  ])(
    'is the not-found page for %s, and cancels nothing',
    async (_name, fields) => {
      await expect(cancelBookingForm(form(fields))).rejects.toThrow(
        'not-found',
      );
      expect(redirect).not.toHaveBeenCalled();
      expect(consumeRateLimit).not.toHaveBeenCalled();
      expect(cancelBookingOrder).not.toHaveBeenCalled();
    },
  );
});
