import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelBooking } from './orders';

const consumeRateLimit = vi.hoisted(() => vi.fn());
const resolveToken = vi.hoisted(() => vi.fn());
const cancelBookingOrder = vi.hoisted(() => vi.fn());
vi.mock('@/server/ports/rate-limit', () => ({ consumeRateLimit }));
vi.mock('@/server/tokens', () => ({ resolveToken }));
vi.mock('@/server/db/orderCancel', () => ({ cancelBookingOrder }));
vi.mock('@/server/orderConfirmation', () => ({ readOrderState: vi.fn() }));

// Behaviours under test, one per decision, branch, or risk:
// - a malformed token or refund is not found, and spends no try and opens nothing
// - the token is counted against the manage limit, by the token, before it is looked up
// - a token over the limit is told to wait, and opens nothing
// - a token that opens nothing is not found, and cancels nothing
// - a token that opens an order cancels exactly that order at the version the token opened, with the refund shown
// - the answer of the cancel is returned as it is
// - a failed rate-limit store or a failed lookup throws, so nothing is cancelled

const token = 'A'.repeat(43);
const input = { manageToken: token, expectedRefundMinor: 13_000 };

beforeEach(() => {
  vi.resetAllMocks();
  consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 29 });
  resolveToken.mockResolvedValue({ id: 'order-1', version: 3 });
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
    expect(resolveToken).not.toHaveBeenCalled();
    expect(cancelBookingOrder).not.toHaveBeenCalled();
  });

  it('counts the try against the manage limit by the token, before the lookup', async () => {
    await cancelBooking(input);

    expect(consumeRateLimit).toHaveBeenCalledWith('manage', token);
    expect(consumeRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      resolveToken.mock.invocationCallOrder[0] ?? 0,
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
    expect(resolveToken).not.toHaveBeenCalled();
    expect(cancelBookingOrder).not.toHaveBeenCalled();
  });

  it('answers not found for a token that opens nothing', async () => {
    resolveToken.mockResolvedValue(null);

    expect(await cancelBooking(input)).toEqual({ status: 'not_found' });
    expect(resolveToken).toHaveBeenCalledWith('manage', token);
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
      orderId: 'order-1',
      openedTokenVersion: 3,
      expectedRefundMinor: 13_000,
    });
  });

  it('throws when the limit store fails, and cancels nothing', async () => {
    consumeRateLimit.mockRejectedValue(new Error('store down'));

    await expect(cancelBooking(input)).rejects.toThrow('store down');
    expect(cancelBookingOrder).not.toHaveBeenCalled();
  });

  it('throws when the token lookup fails, and cancels nothing', async () => {
    resolveToken.mockRejectedValue(new Error('lookup down'));

    await expect(cancelBooking(input)).rejects.toThrow('lookup down');
    expect(cancelBookingOrder).not.toHaveBeenCalled();
  });
});
