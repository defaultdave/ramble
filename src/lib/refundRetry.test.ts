import { describe, expect, it } from 'vitest';
import { parseAuditEntry } from './audit';
import {
  opsFullRefundRequest,
  refundAuditEntry,
  retryPlan,
} from './refundRetry';

// Behaviours under test:
// - the whole-rest ops refund is one key for the order, naming the ops user
// - a retry asks for the failed refund's own ticket part, never the rest of the order, under a key named for that refund
// - it keeps the failed refund's reason when the refund path takes it, and uses the ops reason otherwise
// - it stops for no order, an order not flagged, a gift purchase, no failed refund, and a failed refund with no ticket part
// - it does not look at the booking's status: a confirmed booking's failed partial refund retries
// - the audit row is valid and names the new refund by id, for a request and for a retry

const orderId = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';
const userId = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const flagged = { kind: 'booking', refundFailed: true } as const;
const failed = { id: 'f1', reason: 'guest_cancel', ticketMinor: 8500 };

describe('opsFullRefundRequest', () => {
  it('asks for the whole rest under the one ops key, naming the ops user', () => {
    expect(opsFullRefundRequest(orderId, userId)).toEqual({
      orderId,
      reason: 'ops_adjustment',
      key: 'ops-refund',
      ticketMinor: 'remaining',
      initiatedBy: userId,
    });
  });
});

describe('retryPlan', () => {
  it("retries that refund's own ticket part under a key named for it, keeping a known reason", () => {
    expect(retryPlan({ orderId, userId, order: flagged, failed })).toEqual({
      kind: 'retry',
      request: {
        orderId,
        reason: 'guest_cancel',
        key: 'retry:f1',
        ticketMinor: 8500,
        initiatedBy: userId,
      },
    });
  });

  it('uses the ops reason for a reason the refund path does not take', () => {
    const plan = retryPlan({
      orderId,
      userId,
      order: flagged,
      failed: { ...failed, reason: 'gift_unredeemed' },
    });
    expect(plan.kind === 'retry' && plan.request.reason).toBe('ops_adjustment');
  });

  it.each([
    ['no order', null, failed],
    ['an order not flagged', { kind: 'booking', refundFailed: false }, failed],
    ['a gift purchase', { kind: 'gift_purchase', refundFailed: true }, failed],
    ['no failed refund', flagged, null],
    [
      'a failed refund with no ticket part',
      flagged,
      { ...failed, ticketMinor: 0 },
    ],
  ] as const)('stops for %s', (_name, order, failedRefund) => {
    expect(retryPlan({ orderId, userId, order, failed: failedRefund })).toEqual(
      { kind: 'stop' },
    );
  });
});

describe('refundAuditEntry', () => {
  it.each([
    'booking.ops_refund_requested',
    'booking.ops_refund_retried',
  ] as const)(
    'is a valid row for %s naming the user, the order, and the refund',
    (action) => {
      const entry = refundAuditEntry(action, userId, orderId, orderId);
      expect(() => parseAuditEntry(entry)).not.toThrow();
      expect(entry).toMatchObject({
        actorId: userId,
        action,
        subjectId: orderId,
        details: { refund_id: orderId },
      });
    },
  );
});
