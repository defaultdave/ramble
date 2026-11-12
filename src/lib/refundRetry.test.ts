import { describe, expect, it } from 'vitest';
import { parseAuditEntry } from './audit';
import { refundRetriedEntry, retryPlan } from './refundRetry';

// Behaviours under test:
// - a retry asks for the rest of the order under a key named for the failed refund, naming the ops user
// - it keeps the failed refund's reason when the refund path takes it, and uses the ops reason otherwise
// - it stops for no order, an order not flagged, a gift purchase, and an order with no failed refund
// - the audit row is valid and names the new refund by id

const orderId = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const userId = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const flagged = { kind: 'booking', refundFailed: true } as const;

describe('retryPlan', () => {
  it('retries under a key named for the failed refund and keeps a known reason', () => {
    expect(
      retryPlan({
        orderId,
        userId,
        order: flagged,
        failed: { id: 'f1', reason: 'guest_cancel' },
      }),
    ).toEqual({
      kind: 'retry',
      request: {
        orderId,
        reason: 'guest_cancel',
        key: 'retry:f1',
        ticketMinor: 'remaining',
        initiatedBy: userId,
      },
    });
  });

  it('uses the ops reason for a reason the refund path does not take', () => {
    const plan = retryPlan({
      orderId,
      userId,
      order: flagged,
      failed: { id: 'f1', reason: 'gift_unredeemed' },
    });
    expect(plan.kind === 'retry' && plan.request.reason).toBe('ops_adjustment');
  });

  const failed = { id: 'f1', reason: 'goodwill' };
  it.each([
    ['no order', null, failed],
    ['an order not flagged', { kind: 'booking', refundFailed: false }, failed],
    ['a gift purchase', { kind: 'gift_purchase', refundFailed: true }, failed],
    ['no failed refund', flagged, null],
  ] as const)('stops for %s', (_name, order, failedRefund) => {
    expect(retryPlan({ orderId, userId, order, failed: failedRefund })).toEqual(
      { kind: 'stop' },
    );
  });
});

describe('refundRetriedEntry', () => {
  it('is an audit row naming the ops user, the order, and the new refund', () => {
    const entry = refundRetriedEntry(userId, orderId, orderId);
    expect(() => parseAuditEntry(entry)).not.toThrow();
    expect(entry).toMatchObject({
      actorId: userId,
      action: 'booking.ops_refund_retried',
      details: { refund_id: orderId },
    });
  });
});
